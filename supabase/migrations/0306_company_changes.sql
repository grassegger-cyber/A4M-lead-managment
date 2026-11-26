-- 0306 History of changes of the data of a company (decision of Thomas, 26. 11. 2026): when which
-- value changed, from what to what and where the change came from (import, later CheckMobi, ARES).
-- Changes of the state have their own history (company_state_history).
create table company_changes (
	id bigint generated always as identity primary key,
	ico char(8) not null references companies (ico),
	at timestamptz not null default now(),
	-- name / subject_type / … / phone (main number) / phone_added / operator / owned_from
	field text not null,
	old_value text,
	new_value text,
	-- 'import', later 'checkmobi', 'ares', 'manual'
	source text not null,
	-- e.g. the number of the import; for a phone change the number it is about
	source_ref text,
	subject text,
	actor_name text
);
create index company_changes_ico_idx on company_changes (ico, at desc);
alter table company_changes enable row level security;
