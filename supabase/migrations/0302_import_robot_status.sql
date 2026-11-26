-- 0302 Import column "Stav z robota" (decision of Thomas, 26. 11. 2026) and the new state
-- neni_v_siebelu: the IČO does not exist in Siebel at all and has to be created there by hand.

alter table companies drop constraint companies_state_check;
alter table companies add constraint companies_state_check check (state in (
	'v_poolu', 've_filtru', 'u_robota_ocisteni', 'superuser', 'login_oz', 'vraceno',
	'odvlastneno', 'plovak', 'karantena', 'ztraceno', 'zakaznik', 'neaktivni_ico', 'neni_v_siebelu'));

-- Transitions the import uses (not offered for a manual change) and the ways out of the new state.
insert into state_transitions (from_state, to_state, label_cs, manual_allowed, note_required) values
	('v_poolu', 'superuser', 'Import stavu z robota: jsme vlastníkem', false, false),
	('ve_filtru', 'superuser', 'Import stavu z robota: jsme vlastníkem', false, false),
	('v_poolu', 'neni_v_siebelu', 'Import stavu z robota: IČO v Siebelu není', false, false),
	('ve_filtru', 'neni_v_siebelu', 'Import stavu z robota: IČO v Siebelu není', false, false),
	('u_robota_ocisteni', 'neni_v_siebelu', 'Výsledek robota: IČO v Siebelu není', false, false),
	('neni_v_siebelu', 've_filtru', 'Založeno v Siebelu, znovu do dávky pro robota', true, false),
	('neni_v_siebelu', 'v_poolu', 'Založeno v Siebelu, zpět do poolu', true, true),
	('neni_v_siebelu', 'neaktivni_ico', 'ARES: IČO zaniklo', true, false)
on conflict (from_state, to_state) do nothing;

-- An IČO that is not in Siebel cannot be picked into a batch from the pool.
update settings
set value = value || '["neni_v_siebelu"]'::jsonb, default_value = default_value || '["neni_v_siebelu"]'::jsonb
where key = 'prefilter.blocking_states' and not value ? 'neni_v_siebelu';

insert into settings (key, group_key, value_type, value, default_value, label_cs, help_cs, sort_order) values
	('import.robot_status_values', 'import', 'map',
		'{"owned": ["ano"], "other_owner": ["ne"], "missing_in_siebel": ["ano dopln do siebelu", "dopln do siebelu"]}'::jsonb,
		'{"owned": ["ano"], "other_owner": ["ne"], "missing_in_siebel": ["ano dopln do siebelu", "dopln do siebelu"]}'::jsonb,
		'Hodnoty sloupce „Stav z robota“ v Excelu',
		'Texty (malá písmena bez diakritiky a pomlček): owned = jsme vlastníkem (stav Superuser), other_owner = jiný vlastník (stav se nemění, držitel se zapíše jako Jiný partner), missing_in_siebel = IČO v Siebelu není (stav Není v Siebelu).', 2112),
	('import.robot_owner_login', 'import', 'text', '"KAJZAR2"'::jsonb, '"KAJZAR2"'::jsonb,
		'Ochranný user, na kterém robot IČO drží', 'Zapíše se jako login držitele u řádků se stavem „jsme vlastníkem“.', 2114),
	('import.robot_ownership_months', 'import', 'number', '1'::jsonb, '1'::jsonb,
		'Délka vlastnictví po převzetí robotem (měsíce)', 'Konec vlastnictví = datum vlastnictví plus tolik měsíců. Prodloužení se zapisuje zvlášť.', 2116),
	('import.robot_overwrite_states', 'import', 'list',
		'["v_poolu", "ve_filtru", "u_robota_ocisteni", "neni_v_siebelu"]'::jsonb,
		'["v_poolu", "ve_filtru", "u_robota_ocisteni", "neni_v_siebelu"]'::jsonb,
		'Stavy, ve kterých import smí stav z robota zapsat', 'IČO v jiném stavu (už má vlastníka, zákazník…) import nezmění a vypíše ho v reportu jako upozornění.', 2118);

update settings
set value = value || '{"robot_status": ["stav z robota", "stav robota", "robot", "vysledek robota", "stav"], "owned_from": ["vlastnictvi od", "datum vlastnictvi", "vlastnikem od", "datum prevzeti"]}'::jsonb,
	default_value = default_value || '{"robot_status": ["stav z robota", "stav robota", "robot", "vysledek robota", "stav"], "owned_from": ["vlastnictvi od", "datum vlastnictvi", "vlastnikem od", "datum prevzeti"]}'::jsonb
where key = 'import.header_aliases';

-- A later robot result for an IČO that was missing in Siebel.
insert into state_transitions (from_state, to_state, label_cs, manual_allowed, note_required) values
	('neni_v_siebelu', 'superuser', 'Import stavu z robota: jsme vlastníkem', false, false)
on conflict (from_state, to_state) do nothing;
