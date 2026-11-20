// Czech regions (kraje) and districts (okresy). Public geography, no personal data.
// Codes: region = RÚIAN VÚSC code, district = ČSÚ okres code, as ARES is expected to return
// them (kodKraje / kodOkresu). NOT yet verified against a live ARES response.

export interface District {
	code: string;
	name: string;
}
export interface Region {
	code: string;
	name: string;
	districts: District[];
}

const d = (code: string, name: string): District => ({ code, name });

export const REGIONS: Region[] = [
	{ code: '19', name: 'Hlavní město Praha', districts: [d('3100', 'Praha')] },
	{
		code: '27',
		name: 'Středočeský kraj',
		districts: [
			d('3201', 'Benešov'), d('3202', 'Beroun'), d('3203', 'Kladno'), d('3204', 'Kolín'),
			d('3205', 'Kutná Hora'), d('3206', 'Mělník'), d('3207', 'Mladá Boleslav'), d('3208', 'Nymburk'),
			d('3209', 'Praha-východ'), d('3210', 'Praha-západ'), d('3211', 'Příbram'), d('3212', 'Rakovník')
		]
	},
	{
		code: '35',
		name: 'Jihočeský kraj',
		districts: [
			d('3301', 'České Budějovice'), d('3302', 'Český Krumlov'), d('3303', 'Jindřichův Hradec'),
			d('3305', 'Písek'), d('3306', 'Prachatice'), d('3307', 'Strakonice'), d('3308', 'Tábor')
		]
	},
	{
		code: '43',
		name: 'Plzeňský kraj',
		districts: [
			d('3401', 'Domažlice'), d('3404', 'Klatovy'), d('3405', 'Plzeň-město'), d('3406', 'Plzeň-jih'),
			d('3407', 'Plzeň-sever'), d('3408', 'Rokycany'), d('3410', 'Tachov')
		]
	},
	{
		code: '51',
		name: 'Karlovarský kraj',
		districts: [d('3402', 'Cheb'), d('3403', 'Karlovy Vary'), d('3409', 'Sokolov')]
	},
	{
		code: '60',
		name: 'Ústecký kraj',
		districts: [
			d('3502', 'Děčín'), d('3503', 'Chomutov'), d('3506', 'Litoměřice'), d('3507', 'Louny'),
			d('3508', 'Most'), d('3509', 'Teplice'), d('3510', 'Ústí nad Labem')
		]
	},
	{
		code: '78',
		name: 'Liberecký kraj',
		districts: [
			d('3501', 'Česká Lípa'), d('3504', 'Jablonec nad Nisou'), d('3505', 'Liberec'), d('3608', 'Semily')
		]
	},
	{
		code: '86',
		name: 'Královéhradecký kraj',
		districts: [
			d('3602', 'Hradec Králové'), d('3604', 'Jičín'), d('3605', 'Náchod'),
			d('3607', 'Rychnov nad Kněžnou'), d('3610', 'Trutnov')
		]
	},
	{
		code: '94',
		name: 'Pardubický kraj',
		districts: [
			d('3603', 'Chrudim'), d('3606', 'Pardubice'), d('3609', 'Svitavy'), d('3611', 'Ústí nad Orlicí')
		]
	},
	{
		code: '108',
		name: 'Kraj Vysočina',
		districts: [
			d('3601', 'Havlíčkův Brod'), d('3707', 'Jihlava'), d('3304', 'Pelhřimov'), d('3710', 'Třebíč'),
			d('3714', 'Žďár nad Sázavou')
		]
	},
	{
		code: '116',
		name: 'Jihomoravský kraj',
		districts: [
			d('3701', 'Blansko'), d('3702', 'Brno-město'), d('3703', 'Brno-venkov'), d('3704', 'Břeclav'),
			d('3706', 'Hodonín'), d('3712', 'Vyškov'), d('3713', 'Znojmo')
		]
	},
	{
		code: '124',
		name: 'Olomoucký kraj',
		districts: [
			d('3811', 'Jeseník'), d('3805', 'Olomouc'), d('3709', 'Prostějov'), d('3808', 'Přerov'),
			d('3809', 'Šumperk')
		]
	},
	{
		code: '141',
		name: 'Zlínský kraj',
		districts: [d('3708', 'Kroměříž'), d('3711', 'Uherské Hradiště'), d('3810', 'Vsetín'), d('3705', 'Zlín')]
	},
	{
		code: '132',
		name: 'Moravskoslezský kraj',
		districts: [
			d('3801', 'Bruntál'), d('3802', 'Frýdek-Místek'), d('3803', 'Karviná'), d('3804', 'Nový Jičín'),
			d('3806', 'Opava'), d('3807', 'Ostrava-město')
		]
	}
];

export function regionName(code: string | null | undefined): string {
	if (!code) return '—';
	return REGIONS.find((r) => r.code === code)?.name ?? code;
}
