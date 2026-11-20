-- 0101 companies area: rules of the manual state change.
-- Plain Postgres SQL (PGlite locally, Supabase later).

-- Which holder a manual change into a state sets. Editable in the UI (group "ownership").
-- "vraceno" → pool is an interpretation (the specification names a pool only for "odvlastneno");
-- remove the key in Settings if a returned IČO should keep its holder.
insert into settings (key, group_key, value_type, value, default_value, label_cs, help_cs, sort_order) values
	('ownership.manual_holder_by_state', 'ownership', 'map',
		'{"superuser": "superuser", "vraceno": "pool", "odvlastneno": "pool", "ztraceno": "jiny_partner"}'::jsonb,
		'{"superuser": "superuser", "vraceno": "pool", "odvlastneno": "pool", "ztraceno": "jiny_partner"}'::jsonb,
		'Držitel podle cílového stavu při ruční změně',
		'Cílový stav → typ držitele (superuser, pool, jiny_partner, neznamo), kterého ruční změna stavu nastaví. U typu pool se vybírá jeden z volných poolů. Stav, který tu není, držitele sám nemění. Login OZ sem nepatří, ten plyne z vybraného obchodníka.',
		85)
on conflict (key) do nothing;

-- The reason the user typed when an assignment of a sales rep was ended by a manual change.
alter table company_assignments add column if not exists end_note text;
