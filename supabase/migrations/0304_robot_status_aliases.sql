-- 0304 More header names recognised as the column "Stav z robota" (the files say "Status z robota").
update settings
set value = jsonb_set(value, '{robot_status}',
		coalesce(value->'robot_status', '[]'::jsonb) || '["status z robota", "status robota", "status robot", "status"]'::jsonb),
	default_value = jsonb_set(default_value, '{robot_status}',
		coalesce(default_value->'robot_status', '[]'::jsonb) || '["status z robota", "status robota", "status robot", "status"]'::jsonb)
where key = 'import.header_aliases' and not coalesce(value->'robot_status', '[]'::jsonb) ? 'status z robota';
