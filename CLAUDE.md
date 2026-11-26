# Lead management A4M („Rybník IČO“)

Interní aplikace pro vedení A4M: řízení vlastnictví IČO v Siebelu a přísunu leadů obchodníkům. Zadavatel: Thomas Grassegger.

## Kde co je

- `docs/00-zadani.md` — zadání. Je závazné, při rozporu má přednost. Na jeho konci jsou Změny zadání (rozhodnutí Thomase), ty mají přednost před původním textem.
- `docs/01-navrh-reseni.md` — schválený návrh architektury, datového modelu, integrací a pořadí stavby. Před prací na kroku si přečti jeho část a oddíly 8 (otevřená rozhodnutí) a 9 (podklady).
- `docs/02-lokalni-beh.md` — co zbylo z místní varianty (instalace závislostí, složky `.nosync`).
- `docs/03-ostry-provoz.md` — ostrá cloudová verze: jak drží pohromadě, co nastavuje Thomas, nasazení, místní běh pro vývoj, co je neověřeno.

## Pravidla práce

- Před každým krokem (datový model, nový modul, migrace, instalace knihovny) napiš krátký plán a počkej na souhlas Thomase.
- Měň jen to, o co Thomas žádá. Žádné refaktory ani vylepšení navíc.
- Krok nezačínej, dokud Thomas nedodal podklady, které k němu návrh uvádí.
- Názvy v kódu a komentáře anglicky. Celé UI česky se správnou diakritikou, datum ve tvaru DD. MM. RRRR.
- Hodnoty stavů IČO jsou přesně podle zadání (`v_poolu`, `ve_filtru`, …) a jeho změn (`neni_v_siebelu`).
- Žádné obchodní pravidlo napevno v kódu. Prahy, lhůty, limity, mapování statusů a vzory souborů patří do tabulek nastavení editovatelných v UI (seznam klíčů je v návrhu, oddíl 4.4).
- Do Raynetu se zapisují jen dvě věci (Změny zadání 20. 11. 2026):
  - čtyři vlastní pole firmy (Kohorta, Semafor, Rozhodnutí o vlastnictví, Konec vlastnictví), vždy po náhledu a potvrzení;
  - nové leady dávky, jen s poli IČO, název, telefon, kategorie FOP / PO, operátor (teritorium), zdroj kontaktu, vlastník a téma, po náhledu a jednom potvrzení dávky Thomasem.
- Nic jiného v Raynetu neměň (jiná pole firem, obchodní případy, aktivity, existující leady), štítky nepoužívej.
- Placené volání (CheckMobi) a hromadný zápis nikdy nespouštěj bez potvrzení Thomase.
- Tipařský portál (`../Tipařský portál`) je jen zdroj ke čtení. Nic v něm neměň.
- Co není ověřeno, označ jako neověřené. Nevydávej předpoklad za fakt.

## Git

- Každý krok má vlastní větev (např. `krok-02-master-databaze`). Do `main` přímo nepiš.
- Commit a push dělej jen tehdy, když to Thomas řekne. Platí, dokud nerozhodne jinak.
- Složka je na ploše v iCloudu. Když se git nebo instalace zasekne nebo vzniknou složky s příponou „ 2“, zastav se a řekni to Thomasovi. Nic nemaž.

## Tajemství a osobní údaje

- API klíče, hesla a tokeny nikdy do repozitáře, do dokumentů ani do chatu. Patří jen do tajemství serverové funkce a do GitHub Secrets.
- IČO fyzických osob a telefony jsou osobní údaje. Do repozitáře nepatří žádná ostrá data ani ukázky s reálnými údaji (Excely, výpisy, snímky obrazovky).
- Do logů nepiš telefonní čísla ani těla požadavků.

## Stav projektu

- Krok 2 (master databáze) je postavený. Od 26. 11. 2026 je kód převedený na cloud podle schváleného návrhu: statická aplikace (adapter-static) pro Cloudflare Pages, jedna funkce `api` v Supabase (`supabase/functions/api`, kód v `src/lib/server`), přihlášení přes Supabase Auth s povinným 2FA (TOTP), whitelist e-mailů, RLS bez politik na všech tabulkách, nasazení přes GitHub Actions z větve `main`, migrace ručně s náhledem. Postup a seznam neověřených bodů je v `docs/03-ostry-provoz.md`. Na skutečném Supabase a Cloudflare zatím neběželo.
- Ostrá data nahrává jen Thomas přes Import po přihlášení. V cloudové databázi se smyšlená data nezakládají.
- Místní běh (`npm run dev`) slouží jen k vývoji: bez přihlášení, databáze PGlite v paměti, smyšlená data.
- Excel (import, export IČO, report chyb) se čte i zapisuje v prohlížeči; server vydává jen data po stránkách a export zapisuje do auditu předem.
- Od 26. 11. 2026 navíc: import se sloupcem „Stav z robota“ (ANO / NE / ANO - doplň do Siebelu), třináctý stav `neni_v_siebelu`, obrazovka Lhůty se souborem vrácení statusů a prodloužením o 30 dní. Rozhodnutí jsou v `docs/00-zadani.md`, Změny z 26. 11. 2026.
- Nepostaveno: noční šifrované zálohy, plánovač a fronta úloh.
- Rozhodnuto 19. 11. 2026: Supabase na tarifu zdarma, zálohy vlastní a šifrované.
- Zálohy schváleny 19. 11. 2026: noční, šifrované před odesláním (klíč drží jen Thomas), Cloudflare R2 v EU, držení 30 dní.
- Repozitář je veřejný (rozhodnuto 19. 11. 2026). Vše, co se commitne, uvidí kdokoli: jen smyšlená data, žádné reálné vzory souborů, klíče ani zálohy.
- Rozhodnuto 20. 11. 2026 (Změny zadání, návrh oddíly 3.4 a 5.1): záložky Rybníky (Callcentrum / Obchodníci, stavy leadů z Raynetu) a Exekutiva (koše Držet / Plovák / Odvlastnit), z leadů se ukládá jen IČO, fáze, vlastník, zdroj kontaktu a data (stav leadu a ID navíc jako návrh ke schválení), čtení z Raynetu jednou denně (návrh 6:00), aplikace zakládá leady dávky v Raynetu po jednom potvrzení dávky (zařazení do kroku 9 je návrh).
- Otevřená rozhodnutí: pracovní složka mimo iCloud.

## Kontroly

Před každým návrhem commitu spusť všechny tři a nech je projít:

- `npm run check` (typy),
- `npm test` (testy; na místní data ve složce `data.nosync/` nesahají),
- `npm run build` (sestavení webu i funkce `api`).

Závislosti instaluj jen skriptem `./scripts/install-deps.sh`, ne příkazem `npm install` (důvod je v `docs/02-lokalni-beh.md`). Nová migrace musí mít číslo vyšší než poslední už zapsaná (Supabase je zapisuje podle pořadí názvů a starší číslo odmítne) a do ostré databáze se zapisuje dřív, než se nasadí kód, který ji potřebuje, pokud to starý kód nerozbije. Každá nová tabulka musí mít v migraci zapnuté RLS bez politik (hlídá to test v `src/lib/server/handler.test.ts`). Kód v `src/lib/server` nesmí importovat moduly Node (kromě `db.ts` a `local-dev.ts`, které do cloudové funkce nejdou).

## Vzhled a ovládání (požadavek Thomase, 20. 11. 2026)

- Aplikace musí být co nejpřívětivější: přehledná, hezká, klidná. Vzor je Raynet, ne „typické AI CRM“.
- Žádná malá tlačítka ani drobné písmo. Ovládací prvky v pohodlné velikosti.
- Co nejméně scrollování a klikání. Co spolu souvisí, je na jedné obrazovce; detail se otevírá vedle seznamu, ne na nové stránce, pokud to jde.
- Žádné výplňové texty, zbytečné ikony, ozdobné karty ani prázdné statistiky. Každý prvek na obrazovce má důvod.
- Před odevzdáním obrazovky ji zkontroluj v prohlížeči na běžné šířce notebooku.
- Směr vzhledu (rozhodnuto 20. 11. 2026): Liquid Glass podle návrhového plátna. Navigace a ovládání jako průsvitné sklo nad čistým neutrálním světle šedým pozadím bez barevných přechodů, co nejblíž vzhledu Apple (upřesněno 20. 11. 2026), data na téměř neprůhledných bílých plochách, aby se dobře četla. Z brandu A4M se přebírají jen barvy a logo; pravidla portálu „ostré rohy, bez stínů“ tady neplatí. Popis aplikace pro návrh vzhledu je v `PRODUCT.md`.
