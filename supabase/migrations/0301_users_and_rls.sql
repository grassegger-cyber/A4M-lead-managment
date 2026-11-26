-- Cloud login (proposal 4.1 and 6): the whitelist of users and row level security on every table.
-- Runs unchanged in the tests' PGlite and in a plain Postgres; the Supabase-only parts (roles
-- anon / authenticated) are skipped where those roles do not exist.

-- The local single-password login is gone; passwords and sessions live in Supabase Auth.
drop table if exists sessions;

-- Whitelist: a person gets in only with an active row here AND a session that passed 2FA.
-- id equals auth.users.id in Supabase (no foreign key, so the file also runs outside Supabase).
create table users (
	id uuid primary key,
	email text not null unique check (email = lower(email)),
	first_name text,
	last_name text,
	active boolean not null default true,
	last_login_at timestamptz,
	created_at timestamptz not null default now()
);

-- RLS on every table of the public schema, with no policy: the browser's database roles get
-- nothing, the api function (which connects as the owner) is the only way to the data.
do $$
declare
	t record;
begin
	for t in select tablename from pg_tables where schemaname = 'public' loop
		execute format('alter table public.%I enable row level security', t.tablename);
	end loop;
	if exists (select 1 from pg_roles where rolname = 'anon') then
		revoke all on all tables in schema public from anon, authenticated;
		revoke all on all sequences in schema public from anon, authenticated;
		revoke all on all functions in schema public from anon, authenticated;
		alter default privileges in schema public revoke all on tables from anon, authenticated;
		alter default privileges in schema public revoke all on sequences from anon, authenticated;
		alter default privileges in schema public revoke all on functions from anon, authenticated;
	end if;
end $$;
