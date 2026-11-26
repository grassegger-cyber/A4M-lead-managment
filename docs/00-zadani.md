# Zadání pro Claude Code: Lead management A4M („Rybník IČO“)

## Jak budeme pracovat

Stavíš interní webovou aplikaci pro řízení vlastnictví IČO v Siebelu (Vodafone) a přísunu leadů obchodníkům. Zadavatel je Thomas Grassegger, obchodní ředitel akvizice A4M.

Pravidla spolupráce:
- Před každým krokem (návrh datového modelu, nový modul, migrace, instalace knihovny) mi napiš krátký plán a počkej na souhlas.
- Měň jen to, o co žádám. Žádné refaktory a „vylepšení“ navíc.
- Komentáře v kódu anglicky, celé UI česky (správná diakritika, formát data DD. MM. RRRR).
- Stack: použij stejný stack, hosting a způsob přihlášení jako tipařský portál A4M. Nejdřív si ho projdi a navrhni, co z něj převezmeš (napojení na Raynet API, ARES lookup, auth). Pokud k němu nemáš přístup, zeptej se.
- Všechna obchodní pravidla (prahy, lhůty, limity, mapování statusů) patří do tabulky nastavení editovatelné v UI. Nic z toho nesmí být napevno v kódu. Proces se teprve zabíhá a čísla se budou měnit.

## Účel a kontext

A4M je partner Vodafonu, akviziční tým prodává firmám a OSVČ (B2B). Zákazníka smí oslovit jen partner, který má IČO „ve vlastnictví“ v Siebelu (systém Vodafonu). Vlastnictví má tyto úrovně:

- Superuser Kaiser 2: sem se IČO dostanou přes robota Vodafonu („očištění“). Drží se 1 měsíc, jedno prodloužení až na 2 měsíce, pak se musí vrátit se statusy, nebo převést na login obchodníka. Limit je 6 000 IČO, dočasně 10 000.
- Login obchodníka (OZ): limit 250 IČO fyzických osob (FO) a 250 IČO právnických osob (PO). PO bývají dlouhodobé a obchodník je v Siebelu prodlužuje.
- Volné pooly (VBCPOOL, SADMIN, OBSPOOL): volně obchodovatelné IČO, může je převzít kdokoli. Sem IČO odvlastňujeme.
- Jiný partner: pokud nemá platnou příležitost, lze IČO přeblokovat formulářem IBF Overblocking (Power Apps v Citrixu).

Kmenová databáze je dnes Excel s ~90 000 IČO. CRM je Raynet: obchodníci v něm pracují s klienty, příležitostmi (OP), nabídkami a aktivitami.

Leady mají dva kanály. Operátorka navolá zájem a předá ho obchodníkovi (7–10 leadů denně, rovnoměrně mezi OZ). Obchodník si zbytek najde sám studeným voláním (cold call) z IČO, která mu přidělíme.

Aplikace je jen pro vedení (Thomas a majitel). Obchodníci do ní nechodí, pracují v Raynetu. Později se aplikace začlení do vlastního CRM, proto drž čistou modulární strukturu a vlastní API vrstvu.

Hrubá kapacita: přítok ~3 000–4 500 nových IČO měsíčně, na superuseru ~4 000–6 000 současně, 8–12 obchodníků.

## Hlavní princip

Raynet je pravda o práci s klientem: OP, fáze, aktivity, důvod prohry. Aplikace je pravda o vlastnictví a poolu: kde IČO je, odkdy, dokdy, v jaké kohortě, kdy se k němu vrátit, karanténa. Aplikace z Raynetu čte. Zapisuje do něj jen několik vlastních polí (viz Integrace). (změněno 20. 11. 2026, viz Změny zadání)

## Moduly první verze

(doplněno 20. 11. 2026: záložky Rybníky a Exekutiva, viz Změny zadání)

### 1. Master databáze IČO
- Import Excelu (~90 tisíc řádků) s mapováním sloupců v UI. Deduplikace podle IČO. Report chyb (neplatné IČO, duplicity).
- Údaje u každého IČO: IČO, název, typ subjektu (FO/PO, z ARES), kraj a okres sídla (ARES), telefony, aktuální operátor + datum ověření, platnost IČO + datum ověření.
- Údaje o vlastnictví: aktuální stav (viz stavy níže), aktuální držitel (superuser / login OZ / pool / jiný partner / neznámo), datum od, datum konce vlastnictví, kohorta (dávka), kanál (operátorka / cold call OZ), přiřazený OZ.
- Historie: kompletní log přechodů stavů a přidělení (kdo, kdy, proč). Počet kol, kterými IČO prošlo. Dřívější OZ s daty od–do a důvodem ukončení.
- Datum návratu a karanténa do (vypočtené z pravidel, ručně přepsatelné s poznámkou).
- Vyhledávání a filtry podle všech polí, export do Excelu.

Stavy IČO (stavový automat, přechody jen povolenými cestami, každý se zapíše do historie):
`v_poolu` → `ve_filtru` → `u_robota_ocisteni` → `superuser` → (`login_oz` | `vraceno` | `odvlastneno`) → `plovak` | `karantena` | `ztraceno` (převzal jiný partner) | `zakaznik` (deal) | `neaktivni_ico`

### 2. Předfiltr (ARES, CheckMobi)
- ARES: ověření platnosti IČO, název, právní forma, sídlo (kraj, okres). Veřejné REST API ARES, dávkově s rozumným throttlingem a cache.
- CheckMobi MNP: aktuální operátor telefonního čísla (VF / O2 / TM, včetně přenesených čísel). Placené API, proto volat jen čísla bez ověření nebo s ověřením starším než N dní (nastavení, návrh 180). Před dávkou ukázat počet volání a odhad ceny a vyžádat potvrzení.
- Filtry dávky: platné IČO, operátor ≠ Vodafone, mimo karanténu, mimo jiné aktivní stavy, typ FO/PO, kraj, obor (CZ-NACE z ARES), rok založení (nová IČO z aktuálního roku mají zhruba dvojnásobnou konverzi).

### 3. Dávky a robot (soubory, ne automatizace robota)
Robot Vodafonu neautomatizujeme. Aplikace připraví soubor, Thomas ho nahraje ručně a v aplikaci potvrdí.
- Sestavení dávky (kohorty): výběr přes filtr, cílová velikost, rozdělení na kanál operátorka / cold call (podle pravidel v nastavení, např. FO a malé firmy operátorce, PO a cílové obory OZ).
- Generátor souborů ve vzoru robota pro 4 režimy: očištění, prodloužení, vrácení statusů, odvlastnění (na VBCPOOL / SADMIN). Vzory dodá Thomas. Mapování sloupců a hodnot statusů musí být konfigurovatelné v nastavení, ne v kódu.
- Import výsledku od robota (Excel): která IČO přistála na superuseru a která ne a proč. Nepřevzatá IČO se vrátí do poolu s důvodem.
- U každé dávky časová osa: vytvořeno → soubor stažen → nahráno do robota (datum, potvrzuje Thomas) → výsledek importován → den 25 prodloužení → den 30 checkpoint 1 → den 50 checkpoint 2 → den 55–58 rozhodnutí provedena → den 60 deadline.

### 4. Siebel (Citrix)
Siebel běží v Citrixu a nemá API, ze serveru ho přímo ovládat nejde. Existují dvě hotové automatizace (Claude skills spouštěné na Thomasově počítači přes Citrix):
- `siebel-vlastnik`: pro seznam IČO zjistí vlastníka a platnost nejmladší příležitosti a zapíše výsledek do Excelu se statusem.
- `siebel-preblokace`: podá přeblokace přes formulář IBF Overblocking podle Excelu (IČO, CA, původní vlastník, požadovaný vlastník, scénář A – bez platné příležitosti).

Aplikace k nim musí umět:
- vygenerovat vstupní Excel přesně ve formátu, který skill čeká (formát dodá Thomas),
- naimportovat výstupní Excel a aktualizovat vlastníka, platnost příležitosti a stav,
- založit úkol „Spustit kontrolu vlastníka / přeblokace“ a po importu ho uzavřít.

Navrhni rozhraní tak, aby šlo později nahradit přímou integrací, kdyby Vodafone API zpřístupnil.

### 5. Semafor (checkpointy dávky)
Výpočet nad daty z Raynetu pro každé IČO na superuseru. Všechny prahy jsou v nastavení.

Checkpoint 1 (den 30): červená IČO se vrací už teď, aby superuser nepřetekl. Ostatní jdou do prodloužení.

Checkpoint 2 (den 50), barva pro každé zbývající IČO:
- Zelená, převést na login OZ automaticky:
  - OP ve fázi JEDNÁME / NABÍDKA a úspěšný kontakt za posledních 14 dní, nebo
  - domluvená schůzka či aktivita do 30 dní a potvrzený zájem,
  - a potenciál ≥ 800 BMSL.
- Oranžová, musí rozhodnout člověk do 3 dnů:
  - zájem byl, ale ticho déle než 21 dní,
  - odklad s důvodem (dovolená, „teď není čas“) a datem do 3 měsíců,
  - nekontaktní, ale potenciál ≥ 800 BMSL,
  - lead je pořád otevřený, jen jsme ho nestihli zpracovat,
  - OP bez posunu déle než 30 dní,
  - závazek u konkurence končí za 3–6 měsíců.
- Červená, vrátit nebo odvlastnit: nezájem; nezajímavý (1 číslo bez rodiny, služebák, bez signálu); nekontaktní po celé kadenci a nikdy nezvedl; neaktivní IČO; potenciál < 500 BMSL.

Kdo rozhoduje oranžovou: OZ (v Raynetu přes pole, viz Integrace). Nad 2 000 BMSL, nebo když je login OZ nad 90 % limitu (225 FO / 225 PO), rozhoduje Thomas v aplikaci. (upřesněno 20. 11. 2026: v záložce Exekutiva třemi koši, viz Změny zadání)

Pravidla:
- Bez rozhodnutí do termínu se IČO pustí (výchozí akce = pustit).
- Kdo oranžové IČO vezme, musí mít v Raynetu naplánovanou aktivitu s datem. Bez ní se rozhodnutí neuzná.
- Měsíční revize loginů OZ: převzatá oranžová IČO bez posunu nebo s propadlou aktivitou spadnou do červené.

UI: přehled dávky podle barev, detail IČO s odůvodněním barvy (které podmínky platí), ruční přepsání barvy s povinnou poznámkou.

### 6. Pravidla podle důvodu prohry
Raynet sám zakládá další krok (aktivitu) podle důvodu prohry. To je ověřeno, aplikace aktivity nezakládá. Aplikace z důvodu prohry počítá akci s vlastnictvím a datum návratu. Výchozí tabulka (editovatelná v nastavení, ID číselníku `losingCategory` z Raynetu):

| ID | Důvod prohry | Návrat | Vlastnictví |
|---|---|---|---|
| 122 | Konkurence / cena | 6 měsíců | Plovák; nad 1 500 BMSL držet |
| 292 | Retence | 18 měsíců (závazek 2 roky − 6 m, PO, FO i FOP) | Plovák |
| 123 | Závazek / nechce řešit | konec závazku − 3 m | do 6 m držet, jinak plovák |
| 293 | Závazek / bude řešeno | konec závazku − 3 m | Držet (PO longterm) |
| 243 | Nekontaktní | znovu přes robota za 6 m | Odvlastnit |
| 121 | Signál | 12 měsíců | Odvlastnit + karanténa |
| 294 | Služby pod někým jiným / Šeďák / Služebák | 12 měsíců | Odvlastnit + karanténa |
| 206 | Vodafone / již je zákazníkem | nikdy | Odvlastnit |
| 300 | Ztráta vlastnictví | — | jen zapsat stav `ztraceno` |
| 124 | Jiná | ruční revize | úkol pro Thomase (týdně) |
| 289, 290 | RNW … | ignorovat (není akvizice) | — |

Významy akcí:
- Držet: IČO zůstává na loginu OZ. FO jen pokud je návrat do 3 měsíců.
- Plovák: odvlastnit, ale uložit datum návratu. 2–3 měsíce předem (nastavení) aplikace IČO zařadí ke znovuzískání, tedy do kontroly vlastníka v Siebelu a podle výsledku do přeblokace nebo do robota.
- Odvlastnit + karanténa: na VBC pool. Do dávek se nevrací před koncem karantény.

Datum konce závazku se čte z pole na kartě klienta v Raynetu. Když chybí a důvod ho potřebuje, aplikace založí úkol „doplnit konec závazku“ (pro Thomase, s jménem OZ).

### 7. Přidělování a rotace
- Přidělení IČO obchodníkům pro cold call a rovnoměrné rozdělení leadů od operátorky. (změněno 20. 11. 2026: aplikace leady dávky sama zakládá v Raynetu a přiděluje OZ a operátorkám, viz Změny zadání)
- Regionální pravidlo: OZ má v nastavení typ (jezdí na schůzky / volá online) a domovský kraj. Jezdící OZ dostává jen IČO ze svého kraje (kraj sídla z ARES). Online OZ dostává IČO odkudkoli, přednostně z krajů, kde nikdo nejezdí.
- Rotace při návratu: IČO se při návratu přidělí jinému OZ než tomu, kdo ho měl naposledy. Musí splňovat regionální pravidlo a mít volný limit loginu, při shodě vyhrává nejméně vytížený. U důvodů nezájem a nekontaktní IČO nikdy nejde k OZ, který ho už měl. Když ho prošli všichni OZ v regionu, nebo dosáhlo maximálního počtu kol (nastavení, návrh 3), jde do karantény nebo k rozhodnutí Thomase.
- Hlídání limitů: počet IČO na každém loginu (FO / PO) proti limitu 250 / 250. Na superuseru proti limitu 6 000 (nastavitelné, teď 10 000). Varování od 90 %.

### 8. Úkoly pro vedení (můj pracovní seznam)
Aplikace sama generuje úkoly s termínem. Thomas je odškrtává a u každého vidí, co je hotové, co ne a co je po termínu. Typy úkolů: (doplněno 20. 11. 2026: Exekutiva a potvrzení založení leadů dávky, viz Změny zadání)
- Nahrát dávku X do robota (očištění / prodloužení / vrácení statusů / odvlastnění). Tlačítko „Hotovo – nahráno dne …“ zapíše datum a posune časovou osu dávky.
- Naimportovat výsledek robota pro dávku X (termín = nahrání + 7 dní).
- Spustit kontrolu vlastníka / přeblokace v Siebelu (vstupní Excel ke stažení, import výsledku úkol uzavře).
- Rozhodnout oranžová IČO (počet, odkaz na frontu). Termín = den 53 dávky.
- Revize důvodu „Jiná“ (týdně).
- Doplnit chybějící konec závazku.
- Měsíční revize loginů OZ.
- Varování limitů (superuser, login OZ).

Dashboard: dnešní a propadlé úkoly, dávky na časové ose, obsazenost superuseru a loginů, počty podle barev semaforu.

### 9. Měření (základ, bez složitých grafů)
Pro každou kohortu a kanál: počet IČO → dovoláno → OP → nabídka → deal (z Raynetu). (k „dovoláno“ návrh 20. 11. 2026, viz Změny zadání) Konverze mezi kroky. Rozdělení podle typu FO/PO, kraje, oboru a roku založení. Účel: zjistit skutečnou konverzi IČO → nabídka a podle ní řídit velikost dávek.

## Integrace s Raynetem

- Číst: firmy (podle IČO), OP včetně fáze, stavu a důvodu prohry (`losingCategory`), aktivity (typ, datum, výsledek, zda proběhla), nabídky (hodnota v BMSL), vlastníka OP (OZ), kategorie firmy, pole konec závazku a operátor (obchodní teritorium). (doplněno 20. 11. 2026: leady, viz Změny zadání)
- Synchronizovat jen IČO, která jsou „ve hře“ (superuser + loginy OZ + plovák s blížícím se návratem). Řádově 10–12 tisíc, ne celých 90 tisíc. Respektuj denní limit API Raynetu: inkrementální synchronizace podle data změny, fronta, retry s backoffem, log volání.
- Zapisovat do vlastních polí firmy v Raynetu (založí je administrátor Raynetu, názvy a ID dodá Thomas): Kohorta, Semafor (barva), Rozhodnutí o vlastnictví (Držet / Pustit, toto pole vyplňuje OZ u oranžových), Konec vlastnictví. Nic jiného v Raynetu neměnit. Tagy (štítky) nepoužívat. (změněno 20. 11. 2026: navíc založení nových leadů dávky, viz Změny zadání)
- Před každou hromadnou zápisovou operací do Raynetu ukázat náhled změn a vyžádat potvrzení. (upřesněno 20. 11. 2026: u založení leadů jedno potvrzení na dávku, viz Změny zadání)
- Pozor na data, která se do analýz nepočítají: OP s loginem „David“ (bývalý OZ) z měření vyřadit.

## Bezpečnost a osobní údaje

IČO fyzických osob a telefony jsou osobní údaje. Proto:
- server a databáze v EU,
- přihlášení jen pro whitelist uživatelů (Thomas, majitel) s 2FA, pokud to stack tipařského portálu umožňuje,
- šifrované zálohy denně,
- audit log kdo co změnil nebo exportoval,
- API klíče (Raynet, CheckMobi) jen v proměnných prostředí, nikdy v repozitáři,
- `noindex`, žádná veřejná stránka.

## Pořadí stavby (každý krok = samostatné schválení)

1. Průzkum stacku tipařského portálu a návrh architektury a datového modelu.
2. Master databáze + import Excelu + historie stavů.
3. Předfiltr ARES + CheckMobi.
4. Dávky + generátor souborů pro robota + import výsledků + úkoly kolem robota.
5. Synchronizace z Raynetu (jen čtení). (doplněno 20. 11. 2026: leady a záložka Rybníky, viz Změny zadání)
6. Semafor + checkpointy + fronta oranžových + zápis polí do Raynetu. (doplněno 20. 11. 2026: záložka Exekutiva, viz Změny zadání)
7. Pravidla podle důvodu prohry + plovák + karanténa.
8. Siebel: generátor vstupů, import výstupů, úkoly.
9. Přidělování, rotace, region, limity. (návrh 20. 11. 2026: založení leadů dávky v Raynetu, viz Změny zadání)
10. Dashboard a měření.

Po krocích 4 a 6 proběhne ostrý test na jedné reálné dávce souběžně s ručním postupem a výsledky se porovnají.

## Podklady, které dodá Thomas (bez nich daný krok nezačínej)

(doplněno 20. 11. 2026: podklady k leadům, viz návrh oddíl 9)

- Ukázka kmenového Excelu (struktura sloupců).
- Vzory Excelu pro robota ve všech 4 režimech a seznam návratových statusů.
- Formát vstupu a výstupu skillů `siebel-vlastnik` a `siebel-preblokace`.
- Seznam OZ: jméno, Siebel login, Raynet ID, typ (jezdí / online), domovský kraj.
- Názvy a ID vlastních polí v Raynetu (Kohorta, Semafor, Rozhodnutí o vlastnictví, Konec vlastnictví, Konec závazku).
- API klíč CheckMobi a cena za dotaz.
- Přístup k repozitáři / hostingu tipařského portálu.

## Změny a upřesnění zadání (rozhodnutí Thomase)

Tento oddíl doplňuje text výše, který zůstává beze změny. Kde se od něj liší, platí tento oddíl. Místa, kterých se změna týká, jsou výše označena odkazem „viz Změny zadání“. Podrobnosti a otevřené otázky jsou v návrhu `docs/01-navrh-reseni.md` (oddíly 3.4, 4.10, 5.1, 8.2 a 10).

### 20. 11. 2026

1. **Dvě nové záložky.**
   - **Rybníky:** dva rybníky za jedním přepínačem. Callcentrum = IČO, která volají operátorky. Obchodníci = IČO přidělená každému OZ pro cold call, v Raynetu přidělená tomuto OZ. Oba jsou pohledy nad stejnou master databází IČO, „hlavně pro přehlednost“.
   - **Exekutiva:** seznam konkrétních případů, o kterých rozhoduje jen Thomas, „zda je pustit nebo ne“.
   - Návrhy vzhledu obou záložek jsou na návrhovém plátně (mimo repozitář).
2. **Co záložky ukazují:** stavy z Raynetu, tedy IČO, která jsou v CRM jako lead. Kolik je dovoláno se zájmem, s nezájmem, nedovoláno 1x, 2x a kolik bylo převedeno na klienta. Čísla jde filtrovat podle dávky a měsíce.
3. **Definice** (v nastavení editovatelném v UI, nic napevno v kódu):
   - „Dovoláno“ = lead ve fázi Dovoláno - zájem, Dovoláno - nezájem, Dovoláno - VF, Dovoláno - IZOLACE / nesouhlasí s kontaktem nebo Převedený. Návrh: stejná definice i pro „dovoláno“ v měření (modul 9), potvrdí Thomas.
   - „Zájem“ = Dovoláno - zájem a Převedený.
   - „Převedeno na klienta“ = lead ve fázi Převedený (lead převedený na klienta), lead OZ i lead operátorky. Obvykle předtím prošel fází Dovoláno - zájem a často k němu vznikne obchodní případ.
   - Leady ve fázi Zrušený se do rybníků nepočítají (výchozí návrh, Thomas nic nenamítl).
   - Pokusy („nedovoláno 1x, 2x“) se berou z fáze leadu, nikdy z počtu aktivit.
   - Kanál se pozná podle pole leadu „Zdroj kontaktu“: „LEAD OBCHODNIK“ = cold call OZ, „LEAD CC <jméno operátorky>“ = callcentrum.
4. **Datum předání:** vlastní pole leadu „Datum předání“ je den, kdy operátorka předala lead obchodníkovi. Z něj se počítá rovnoměrné rozdělení leadů od operátorky (modul 7).
5. **Rozhodnutí v Exekutivě** jsou tři koše: Držet (= převlastnit na login OZ), Plovák (není to špatný kontakt, vrátit se k němu k datu) a Odvlastnit (pustit na VBC pool, karanténa podle pravidel). Plovák a Odvlastnit odpovídají významům akcí v modulu 6 („Významy akcí“); Držet zde znamená jen převlastnit na login OZ.
6. **Stavy z Raynetu se obnovují jednou denně** („to bude stačit klidně 1x denně“), návrh v 6:00.
7. **Zápis do Raynetu se rozšiřuje** (výslovná volba Thomase „Ano, po potvrzení dávky“):
   - Aplikace sama založí leady dávky v Raynetu a přidělí je OZ a operátorkám podle pravidel přidělování (modul 7). „Musí to fungovat automaticky“, ale každá dávka potřebuje jedno potvrzení Thomase po náhledu: kolik leadů, komu, kolik volání Raynetu a zbývající denní rozpočet.
   - Na novém leadu smí aplikace vyplnit jen: IČO, název, telefon, kategorii FOP / PO, operátora (teritorium), zdroj kontaktu („LEAD OBCHODNIK“ / „LEAD CC <jméno operátorky>“), vlastníka (OZ nebo operátorka) a téma s dávkou a krajem. Štítky ne.
   - U firem platí dál jen čtyři vlastní pole (Kohorta, Semafor, Rozhodnutí o vlastnictví, Konec vlastnictví) s náhledem a potvrzením. Nic jiného v Raynetu (jiná pole firem, obchodní případy, aktivity, existující leady) aplikace nemění.
8. **Čtení leadů z Raynetu** (doplňuje seznam „Číst“ v Integraci): z leadů se ukládá jen IČO, fáze, vlastník, zdroj kontaktu a data (datum leadu, datum předání, datum převodu, pokud ho Raynet vrací). Jména, telefony a poznámky se neukládají, místo nich je odkaz „Otevřít v Raynetu“. Navíc (návrh, ke schválení): stav leadu a ID z Raynetu, kvůli kontrole otevřeného leadu a odkazu „Otevřít v Raynetu“.
9. **Pořadí stavby:** Rybníky se stavy z Raynetu přijdou s krokem 5, kontrola rovnoměrného předávání s krokem 9. Exekutiva vznikne s krokem 6, další skupiny případů přibudou v krocích 7 a 9. Založení leadů dávky je navržené do kroku 9 (návrh, Thomas ho zatím nepotvrdil), protože potřebuje klienta Raynetu a zrcadlo leadů z kroku 5, import výsledku robota z kroku 4 a pravidla přidělování z kroku 9.
10. Fakta o leadech přečtená 20. 11. 2026 se souhlasem Thomase z ostré instance Raynetu (jen nastavení a fáze leadů, nic se neuložilo ani nezměnilo) jsou v návrhu, oddíl 5.1.
11. Důsledek bodu 7 (otevřené, otázka 8.2 č. 32): IČO, které má v Raynetu jen lead, nemá firmu, takže u něj nejde zapsat Kohortu, Semafor ani Konec vlastnictví a OZ nemá kam zapsat Rozhodnutí o vlastnictví. Rozhodne Thomas před krokem 6.

### Změny z 26. 11. 2026 (rozhodnutí Thomase)

1. **Ostrá verze v cloudu** s přihlášením (e-mail, heslo, povinné 2FA) a obnovou hesla odkazem z e-mailu. Postup je v `03-ostry-provoz.md`.
2. **Import umí sloupec „Stav z robota“** (výsledek čištění robotem v Siebelu). Hodnoty a jejich význam:
   - `ANO`: jsme vlastníkem. Stav `superuser`, držitel ochranný user (výchozí KAJZAR2), vlastnictví od data v souboru nebo ode dne importu, konec vlastnictví za 30 dní. Prodloužení o dalších 30 dní se žádá souborem vrácení statusů (bod 5).
   - `ANO - doplň do Siebelu`: IČO v Siebelu vůbec není a musí se ručně založit. **Nový stav `neni_v_siebelu`** („Není v Siebelu“), třináctý stav vedle dvanácti původních. Po založení jde IČO znovu do dávky pro robota (`neni_v_siebelu → ve_filtru`).
   - `NE`: v Siebelu je jiný vlastník, nejde přeblokovat. Není to „ztraceno“: stav se nemění, jen se zapíše držitel „Jiný partner – nerozpoznáno“. Jak se s těmito IČO pracuje dál, Thomas teprve určí.
3. U IČO, které v databázi už je, import stav z robota zapíše jen ve stavech `v_poolu`, `ve_filtru`, `u_robota_ocisteni` a `neni_v_siebelu`. Jakmile u IČO známe vlastníka nebo detail (login OZ, zákazník, plovák…), import ho nezmění a vypíše ho v reportu jako upozornění. Důvod: soubor nese jen základní údaje, aplikace ví víc.
4. Texty hodnot, ochranný user, délka vlastnictví a seznam přepisovatelných stavů jsou v Nastavení (skupina Import).
5. **Lhůty a soubor vrácení statusů.** První lhůta po převzetí robotem je nejvýše 30 dní; aplikace počítá s rezervou 5 dní (soubor má odejít nejpozději 5 dní před koncem). Obrazovka Lhůty ukazuje, kolik IČO je potřeba vrátit a do kdy, a vyrobí soubor ve formátu operátora (list `statuses`, sloupce `ICO` a `STATUS`). V prvním kole má každé IČO status „Prodloužit o 30 dnů“; ten jde použít jen jednou. Po potvrzení, že soubor odešel, aplikace posune konec vlastnictví o 30 dní. Texty statusů jsou podle pravidel operátora, která Thomas dodal: „Dovoláno – zájem“, „Dovoláno – nezájem“, „Dovoláno – IZOLACE“, „Nedovoláno“, „Prodloužit o 30 dnů“ (NEOVĚŘENO: ukázkový soubor operátora má tvar „Dovoláno-nezájem“ bez mezer; znění je v Nastavení).
6. Kdo je „v prohře“ a prodlužovat se nemá, se bude brát z Raynetu přes API. Řeší se později, do té doby se prodlužuje vše, co Thomas z výběru nevyřadí.
7. **Import ukazuje rozdíly proti databázi a nechá vybrat, co přepsat.** U IČO, která v databázi už jsou, se chybějící údaj doplní vždy. Kde se údaj v souboru liší od uloženého (název, typ, právní forma, kraj, okres, NACE, datum vzniku, číslo CA), rozhoduje Thomas u každého pole pro daný import: přepsat, nebo nechat původní. Výchozí volba je z Nastavení. Telefony se jen přidávají. Pravidlo z bodu 3 (stav z robota se nezapíše u IČO se známým vlastníkem) tím obejít nejde.
