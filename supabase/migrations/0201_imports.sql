-- 0201 Excel import (companies agent area "import"): uploaded files and their staged rows.
-- Plain Postgres SQL (PGlite locally, Supabase later).

-- ---------- imports: one row per uploaded file ----------
create table imports (
	id bigint generated always as identity primary key,
	kind text not null default 'master_import' check (kind in ('master_import')),
	filename text not null,
	sheet_name text,
	status text not null default 'uploading' check (status in (
		'uploading', 'uploaded', 'validated', 'applying', 'applied', 'cancelled')),
	-- { "<target field>": ["<header text>", ...] } as chosen in the mapping step.
	mapping jsonb not null default '{}'::jsonb,
	-- Rule values (from settings) frozen at validation, so the report says what it was checked with.
	rules jsonb,
	-- Counts reported by the browser.
	declared_rows integer not null default 0,
	empty_rows integer not null default 0,
	-- Counts kept by the server.
	received_rows integer not null default 0,
	validated_rows integer not null default 0,
	rows_new integer,
	rows_update integer,
	rows_duplicate integer,
	rows_invalid_ico integer,
	rows_error integer,
	rows_warning integer,
	-- Progress of the write: every staged row up to this row number is written.
	applied_through_row integer not null default 0,
	applied_new integer not null default 0,
	applied_updated integer not null default 0,
	applied_unchanged integer not null default 0,
	applied_phones integer not null default 0,
	created_at timestamptz not null default now(),
	created_by uuid,
	created_by_name text,
	uploaded_at timestamptz,
	validated_at timestamptz,
	confirmed_at timestamptz,
	confirmed_by_name text,
	applied_at timestamptz,
	cancelled_at timestamptz,
	-- Set when the staged rows were deleted after the retention period.
	rows_purged_at timestamptz
);
create index imports_created_idx on imports (created_at desc);
create index imports_status_idx on imports (status);

-- ---------- import_rows: staged rows before the write, problem rows afterwards ----------
-- After a successful write the clean rows are deleted; rows with a problem stay for the error
-- report until retention.import_error_rows_days passes (their data holds phone numbers).
create table import_rows (
	import_id bigint not null references imports (id) on delete cascade,
	-- Row number in the Excel sheet (1-based, as the user sees it).
	row_no integer not null check (row_no > 0),
	-- Raw mapped cell texts as sent by the browser: { ico, name, ..., phones: [] }.
	data jsonb not null,
	status text not null default 'pending' check (status in (
		'pending', 'parsed', 'new', 'update', 'duplicate', 'invalid_ico', 'error')),
	-- Normalised IČO (8 digits) when it passed the check.
	ico char(8),
	-- Normalised values ready for the write.
	parsed jsonb,
	-- Blocking problem (status invalid_ico / error): code from the import rules.
	error_code text,
	-- For duplicates: the row that is used instead.
	duplicate_of integer,
	-- Non-blocking problems: [{ code, field, value }]. The row is written without that value.
	warnings jsonb,
	primary key (import_id, row_no)
);
create index import_rows_status_idx on import_rows (import_id, status);
create index import_rows_ico_idx on import_rows (import_id, ico);
