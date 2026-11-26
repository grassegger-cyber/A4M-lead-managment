# Product

<!-- impeccable:product-schema 1 -->

Potvrdil Thomas Grassegger 20. 11. 2026. Zdroj faktů: `docs/00-zadani.md` (závazné zadání) a `docs/01-navrh-reseni.md` (schválený návrh).

## Platform

web

## Users

Dva lidé z vedení A4M (partner Vodafonu, akvizice B2B): Thomas Grassegger, obchodní ředitel akvizice, a majitel firmy. Pracují u stolu na Macu (notebook, denní světlo) v soustředěných blocích: kontrolují stav „rybníka“ IČO, hledají firmy, přesouvají IČO mezi stavy a rozhodují o vlastnictví. Obchodníci (OZ) ani operátorky do aplikace nechodí, pracují v Raynetu.

## Product Purpose

Aplikace je pravda o vlastnictví IČO v Siebelu (systém Vodafonu): kde které IČO je, odkdy, dokdy, v jaké dávce, u kterého OZ, kdy se k němu vrátit a jestli je v karanténě. Řídí přísun leadů obchodníkům a hlídá limity loginů. Úspěch znamená, že vedení v každém okamžiku ví, co s kterým IČO udělat a do kdy, a nic nepropadne kvůli termínu.

## Positioning

Raynet zůstává pravdou o práci s klientem (leady a jejich fáze, obchodní případy, aktivity, důvod prohry). Tahle aplikace je pravda o vlastnictví a poolu. Z Raynetu čte. Zapisuje do něj jen dvě věci: čtyři vlastní pole firmy (Kohorta, Semafor, Rozhodnutí o vlastnictví, Konec vlastnictví), vždy po náhledu a potvrzení, a nové leady dávky přidělené OZ a operátorkám, po náhledu a jednom potvrzení dávky (rozhodl Thomas 20. 11. 2026). Nic jiného v Raynetu nemění.

## Operating Context

- Kmen asi 90 000 IČO, přítok 3 000–4 500 nových IČO měsíčně, na superuseru 4 000–6 000 současně, 8–12 OZ.
- Dávka (kohorta) žije 60 dní na superuseru: den 25 prodloužení, den 30 checkpoint 1, den 50 checkpoint 2 (semafor zelená / oranžová / červená), den 53 termín rozhodnutí oranžových, den 55–58 rozhodnutí provedena, den 60 deadline.
- Robota Vodafonu ani Siebel (Citrix) aplikace neovládá: připraví soubor, Thomas ho nahraje ručně a v aplikaci potvrdí.
- Limity: superuser 10 000 (trvale 6 000), login OZ 250 FO a 250 PO, varování od 90 %.

## Capabilities and Constraints

- Hotovo (krok 2, místní varianta): master databáze, import Excelu s mapováním sloupců, historie stavů, stavový automat, nastavení, audit, export. Další moduly (předfiltr, dávky a robot, synchronizace Raynetu, semafor, důvody prohry, Siebel, přidělování, dashboard) se staví po krocích podle návrhu.
- Nové záložky (rozhodl Thomas 20. 11. 2026, zatím nepostavené): Rybníky (Callcentrum / Obchodníci: stavy leadů z Raynetu, trychtýř Dovoláno → Zájem → Převedeno na klienta, filtr podle dávky a měsíce) a Exekutiva (případy, o kterých rozhoduje jen Thomas, koše Držet / Plovák / Odvlastnit).
- Stavy z Raynetu se čtou jednou denně ráno, obrazovka ukazuje čas posledního čtení, nikdy „v reálném čase“. Z leadů se neukládají jména ani telefony, místo nich je odkaz „Otevřít v Raynetu“.
- Celé UI česky se správnou diakritikou, datum ve tvaru DD. MM. RRRR, mezera mezi tisíci.
- Všechna obchodní pravidla (prahy, lhůty, limity, mapování) jsou v nastavení editovatelném v UI, nic napevno v kódu.
- Hromadné zápisy do Raynetu (čtyři pole firmy, založení leadů dávky jedním potvrzením na dávku) a placená volání (CheckMobi) jen po náhledu a potvrzení.
- Repozitář je veřejný: jen smyšlená data.

## Brand Commitments

- Z brandu A4M se přebírají jen barvy (inkoustová modř #0B1B33, žlutá #F5C518) a logo.
- Vzhled Liquid Glass (rozhodl Thomas 20. 11. 2026). Vzor přívětivosti je Raynet, ne „typické AI CRM“.
- Semafor zelená / oranžová / červená je navržená výjimka z brand manuálu, vždy s textem vedle barvy; definitivně ji potvrdí Thomas v kroku 6.

## Evidence on Hand

- Zadání `docs/00-zadani.md` a návrh `docs/01-navrh-reseni.md`.
- Jen smyšlená data ze seed skriptu (`scripts/seed.ts`, 10 000 IČO „Testovací firma …“). Reálné údaje, vzory souborů Vodafonu ani snímky obrazovky s reálnými daty do repozitáře nepatří.

## Product Principles

1. Co spolu souvisí, je na jedné obrazovce; detail se otevírá vedle seznamu.
2. Co nejméně scrollování a klikání; žádná malá tlačítka ani drobné písmo.
3. Každý prvek má důvod: žádné výplňové texty, ozdobné karty ani prázdné statistiky.
4. Termíny a rozhodnutí jsou vidět dřív, než propadnou, a výchozí akce je vždy vidět.
5. Nic se nezapíše ven bez náhledu a potvrzení.

## Accessibility & Inclusion

Text s kontrastem aspoň 4,5:1, ovládací prvky aspoň 44 px vysoké, stav nikdy jen barvou, vždy s textem.
