# Lead management A4M („Rybník IČO“)

Interní aplikace pro vedení A4M: řízení vlastnictví IČO v Siebelu a přísunu leadů obchodníkům. Zadavatel: Thomas Grassegger.

## Kde co je

- `docs/00-zadani.md` — zadání. Je závazné, při rozporu má přednost.
- `docs/01-navrh-reseni.md` — schválený návrh architektury, datového modelu, integrací a pořadí stavby. Před prací na kroku si přečti jeho část a oddíly 8 (otevřená rozhodnutí) a 9 (podklady).
- `docs/02-lokalni-beh.md` — jak spustit místní variantu, kde leží data a známá omezení.

## Pravidla práce

- Před každým krokem (datový model, nový modul, migrace, instalace knihovny) napiš krátký plán a počkej na souhlas Thomase.
- Měň jen to, o co Thomas žádá. Žádné refaktory ani vylepšení navíc.
- Krok nezačínej, dokud Thomas nedodal podklady, které k němu návrh uvádí.
- Názvy v kódu a komentáře anglicky. Celé UI česky se správnou diakritikou, datum ve tvaru DD. MM. RRRR.
- Hodnoty stavů IČO jsou přesně podle zadání (`v_poolu`, `ve_filtru`, …).
- Žádné obchodní pravidlo napevno v kódu. Prahy, lhůty, limity, mapování statusů a vzory souborů patří do tabulek nastavení editovatelných v UI (seznam klíčů je v návrhu, oddíl 4.4).
- Do Raynetu se zapisují jen čtyři vlastní pole firmy (Kohorta, Semafor, Rozhodnutí o vlastnictví, Konec vlastnictví), vždy po náhledu a potvrzení. Nic jiného v Raynetu neměň, štítky nepoužívej.
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

- Krok 2 (master databáze) je postavený jako místní varianta a běží jen na Thomasově Macu (stav k 20. 11. 2026, zatím necommitnuto): SvelteKit se serverem (adapter-node), databáze PGlite ve složce `data.nosync/`, přihlášení jedním heslem, jedna adresa `POST /api`. V databázi jsou jen smyšlená data. Spuštění a rozdíly proti cloudovému návrhu popisuje `docs/02-lokalni-beh.md`.
- Cílový stack zůstává schválený, ale zatím není nasazený (stejný jako tipařský portál): SvelteKit jako statická aplikace na Cloudflare Pages, samostatný projekt Supabase ve Frankfurtu, jedna serverová funkce `api`, povinné 2FA (TOTP), nasazení pushem do `main` přes GitHub Actions, migrace ručně s náhledem.
- Rozhodnuto 19. 11. 2026: Supabase na tarifu zdarma, zálohy vlastní a šifrované.
- Zálohy schváleny 19. 11. 2026: noční, šifrované před odesláním (klíč drží jen Thomas), Cloudflare R2 v EU, držení 30 dní.
- Repozitář je veřejný (rozhodnuto 19. 11. 2026). Vše, co se commitne, uvidí kdokoli: jen smyšlená data, žádné reálné vzory souborů, klíče ani zálohy.
- Otevřená rozhodnutí: pracovní složka mimo iCloud.

## Kontroly

Před každým návrhem commitu spusť všechny tři a nech je projít:

- `npm run check` (typy),
- `npm test` (testy; na místní data ve složce `data.nosync/` nesahají),
- `npm run build` (sestavení).

Závislosti instaluj jen skriptem `./scripts/install-deps.sh`, ne příkazem `npm install` (důvod je v `docs/02-lokalni-beh.md`). Po změně kódu serveru nebo migrací aplikaci zastav a spusť znovu; migrace se provádějí jen při startu.

## Vzhled a ovládání (požadavek Thomase, 20. 11. 2026)

- Aplikace musí být co nejpřívětivější: přehledná, hezká, klidná. Vzor je Raynet, ne „typické AI CRM“.
- Žádná malá tlačítka ani drobné písmo. Ovládací prvky v pohodlné velikosti.
- Co nejméně scrollování a klikání. Co spolu souvisí, je na jedné obrazovce; detail se otevírá vedle seznamu, ne na nové stránce, pokud to jde.
- Žádné výplňové texty, zbytečné ikony, ozdobné karty ani prázdné statistiky. Každý prvek na obrazovce má důvod.
- Před odevzdáním obrazovky ji zkontroluj v prohlížeči na běžné šířce notebooku.
- Směr vzhledu (rozhodnuto 20. 11. 2026): Liquid Glass podle návrhového plátna. Navigace a ovládání jako průsvitné sklo nad čistým neutrálním světle šedým pozadím bez barevných přechodů, co nejblíž vzhledu Apple (upřesněno 20. 11. 2026), data na téměř neprůhledných bílých plochách, aby se dobře četla. Z brandu A4M se přebírají jen barvy a logo; pravidla portálu „ostré rohy, bez stínů“ tady neplatí. Popis aplikace pro návrh vzhledu je v `PRODUCT.md`.
