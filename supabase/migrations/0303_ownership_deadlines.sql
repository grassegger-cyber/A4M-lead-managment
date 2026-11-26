-- 0303 Ownership deadlines and the file of returned statuses (decision of Thomas, 26. 11. 2026).
-- The first period after the robot took an IČO is 30 days at most; the file with statuses has to
-- go back to the operator a few days before that (reserve). "Prodloužit o 30 dnů" may be used once.

alter table companies add column ownership_extended_on date;

-- One generated file of returned statuses and what it contained, so that the confirmation
-- ("sent to the operator") applies to exactly the IČO that were in the file.
create table status_returns (
	id bigint generated always as identity primary key,
	created_at timestamptz not null default now(),
	created_by uuid,
	created_by_name text,
	filter jsonb,
	total integer not null,
	extend_count integer not null,
	blank_count integer not null,
	confirmed_at timestamptz,
	confirmed_by_name text,
	extended_count integer,
	cancelled_at timestamptz
);
create table status_return_items (
	return_id bigint not null references status_returns (id) on delete cascade,
	ico char(8) not null,
	status_key text,
	primary key (return_id, ico)
);
alter table status_returns enable row level security;
alter table status_return_items enable row level security;

insert into settings (key, group_key, value_type, value, default_value, label_cs, help_cs, sort_order) values
	('ownership.return_reserve_days', 'ownership', 'number', '5'::jsonb, '5'::jsonb,
		'Rezerva před koncem vlastnictví (dny)', 'Soubor se statusy má odejít nejpozději tolik dní před koncem vlastnictví.', 75),
	('ownership.watch_days', 'ownership', 'list', '[7, 14]'::jsonb, '[7, 14]'::jsonb,
		'Hranice přehledu lhůt (dny)', 'Skupiny na obrazovce Lhůty: do kolika dní je potřeba soubor odeslat.', 76),
	('returned_statuses.labels', 'ownership', 'map',
		'{"extend": "Prodloužit o 30 dnů", "interest": "Dovoláno – zájem", "no_interest": "Dovoláno – nezájem", "isolation": "Dovoláno – IZOLACE", "unreachable": "Nedovoláno"}'::jsonb,
		'{"extend": "Prodloužit o 30 dnů", "interest": "Dovoláno – zájem", "no_interest": "Dovoláno – nezájem", "isolation": "Dovoláno – IZOLACE", "unreachable": "Nedovoláno"}'::jsonb,
		'Texty statusů v souboru vrácení statusů', 'Přesné znění, jak ho čte robot operátora.', 77),
	('returned_statuses.file', 'ownership', 'map',
		'{"sheet": "statuses", "ico_header": "ICO", "status_header": "STATUS"}'::jsonb,
		'{"sheet": "statuses", "ico_header": "ICO", "status_header": "STATUS"}'::jsonb,
		'Podoba souboru vrácení statusů', 'Název listu a záhlaví dvou sloupců.', 78);

-- The length of the first period is the existing setting ownership.superuser_hold_days (days).
delete from settings where key = 'import.robot_ownership_months';
