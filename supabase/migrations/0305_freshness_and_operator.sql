-- 0305 How old the information is (decision of Thomas, 26. 11. 2026) and the import column "Operátor".

-- When the state / ownership was last confirmed by a source (robot result, Siebel, a manual change).
alter table companies add column state_verified_at timestamptz;
create index companies_state_verified_idx on companies (state_verified_at);

update companies c set state_verified_at = h.at
from (
	select ico, max(at) as at from company_state_history
	where source in ('manual', 'robot', 'siebel') or reason_code like 'import_robot%'
	group by ico
) h
where h.ico = c.ico;

insert into settings (key, group_key, value_type, value, default_value, label_cs, help_cs, sort_order) values
	('import.operator_values', 'import', 'map',
		'{"VF": ["vodafone", "vf", "voda"], "TM": ["t mobile", "tmobile", "tm", "t mobile czech republic"], "O2": ["o2", "o2 czech republic"], "jiny": ["jiny", "jiny operator", "ostatni"]}'::jsonb,
		'{"VF": ["vodafone", "vf", "voda"], "TM": ["t mobile", "tmobile", "tm", "t mobile czech republic"], "O2": ["o2", "o2 czech republic"], "jiny": ["jiny", "jiny operator", "ostatni"]}'::jsonb,
		'Hodnoty sloupce „Operátor“ v Excelu',
		'Texty (malá písmena bez diakritiky a pomlček), které znamenají Vodafone (VF), T-Mobile (TM), O2 a jiného operátora (jiny). Operátor se zapíše k prvnímu telefonu řádku.', 2113)
on conflict (key) do nothing;

update settings
set value = value || '{"operator": ["operator", "operator telefonu", "mobilni operator", "sit"]}'::jsonb,
	default_value = default_value || '{"operator": ["operator", "operator telefonu", "mobilni operator", "sit"]}'::jsonb
where key = 'import.header_aliases' and not value ? 'operator';
