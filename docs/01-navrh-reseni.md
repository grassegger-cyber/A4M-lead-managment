# Návrh řešení: Lead management A4M („Rybník IČO“)

Stav: návrh ke kroku 1 ze zadání (`docs/00-zadani.md`). Datum: 19. 11. 2026.
Podklad: průzkum tipařského portálu (pět nezávislých čtení kódu a veřejné dokumentace Raynetu, ARES, CheckMobi a Supabase). V portálu nebylo nic změněno.

Značení v textu:
- **OVĚŘENO** = zjištěno z kódu portálu, z dokumentace dodavatele nebo živým dotazem.
- **NEOVĚŘENO** = předpoklad, který se musí potvrdit před krokem, který na něm stojí.
- **NÁVRH** = číslo nebo pravidlo, které zadání neuvádí a navrhuji ho já. Vše takové je v nastavení a dá se změnit.

---

## 1. Shrnutí

- Aplikace poběží na stejném základu jako tipařský portál: webová aplikace na Cloudflare Pages, databáze a přihlášení v samostatném projektu Supabase ve Frankfurtu, jedna serverová funkce `api` jako vlastní API vrstva. Nasazení pushem do větve `main`.
- Z portálu jde převzít přihlášení s 2FA, kostra serveru, klient Raynetu (jen přenosová vrstva), základ ARES, validace IČO a telefonu, vzhled, plánovač úloh a nasazovací postup. Odhadem třetina základů je hotová.
- Nově se musí postavit: tabulka pro 90 tisíc řádků se stránkováním na serveru, práce s Excelem, obecná fronta úloh na pozadí, čtení seznamů z Raynetu (firmy, OP, aktivity, nabídky), zápis vlastních polí do Raynetu, dávkový ARES, CheckMobi, a všechna obchodní logika (stavy, semafor, důvody prohry, rotace).
- Všechna obchodní čísla a pravidla jsou v tabulkách nastavení (oddíl 4.4). V kódu není žádný práh, lhůta ani limit.
- Raynet má denní limit 24 000 volání na celou instanci, sdílený s tipařským portálem. Návrh počítá s vlastním stropem 12 000 volání denně a běžný den spotřebuje stovky. Hromadný zápis polí pro jednu dávku (asi 4 000 IČO) se vejde do jednoho dne.
- ARES zvládne 100 IČO na jeden dotaz. Celých 90 tisíc IČO je 900 dotazů, při navrženém tempu asi 90 minut, plus jednotlivé dotazy pro IČO, která v dávkové odpovědi chybí (při tisících zaniklých IČO další hodiny, oddíl 5.2).
- CheckMobi stojí podle ceníku 0,002 USD za dotaz. 90 tisíc čísel je asi 180 USD. Jestli CheckMobi u českých čísel správně pozná přenesená čísla, není ověřeno a musí se otestovat na několika známých číslech před první placenou dávkou.
- Tři rozhodnutí zůstávají otevřená: tarif Supabase a způsob záloh, viditelnost repozitáře, pracovní složka mimo iCloud (oddíl 8). Bez prvního nelze projekt založit.
- V zadání je několik míst, která nejdou z textu jednoznačně odvodit (oddíl 8.2). Nejdůležitější: jak se v Raynetu pozná „úspěšný kontakt“, „potvrzený zájem“ a „potenciál v BMSL“, a kdo zakládá firmy z dávky do Raynetu.

---

## 2. Co přebíráme z tipařského portálu

Cesty jsou relativní ke složce `Tipařský portál`. „Převzít“ znamená zkopírovat a upravit, portál se nemění.

| Co | Zdrojové soubory v portálu | Jak naložíme |
|---|---|---|
| Vstup serverové funkce: CORS, seznam povolených metod, ověření tokenu, kontrola 2FA, převod chyb | `src/server/obsluha.ts`, `src/server/vstup.ts`, `supabase/functions/api/index.ts` | Převzít. Seznam metod nový. Kontrola přihlášení a 2FA jednou centrálně před spuštěním metody, ne v každé metodě zvlášť. Žádná veřejná metoda. |
| Základ serveru: dva databázoví klienti, zápis do audit logu, tajné kódy | `src/server/zaklad.ts` | Převzít. Pravidlo zjednodušit na „účet existuje, je aktivní a tato relace prošla 2FA“ (úroveň `aal2` v tokenu relace, ne jen „účet má zapsaný faktor“). Vypustit role, partnery a „Zobrazit jako“. |
| Stav přihlášení a 2FA na serveru | `src/server/ucty.ts` | Převzít část: stav přihlášení, počet ověřených TOTP faktorů. Počet faktorů slouží jen k rozhodnutí, jestli uživatele poslat na první nastavení 2FA. O přístupu rozhoduje jen `aal2` relace. Vypustit pozvánky e-mailem a souhlasy. |
| Přihlášení v prohlížeči: heslo, TOTP, konec relace, volání API | `src/lib/data/supabase.ts`, `src/lib/data/zdroj.ts`, `src/lib/odhlaseni.ts` | Převzít. Odstranit vypnutí 2FA. Změnit klíče v prohlížeči a název v Authenticatoru, aby se nepletl s portálem. |
| Přihlašovací stránka a komponenta 2FA | `src/routes/prihlaseni/+page.svelte`, `src/lib/components/ucet/Dvoufaz.svelte`, `ucet/PoleHesla.svelte`, `src/routes/pozvanka/+page.svelte`, `src/routes/nove-heslo/+page.svelte` | Převzít bez demo režimu a testovacích účtů. |
| Ochrana stránek v prohlížeči | `src/routes/+layout.svelte` (ř. 37–70), `src/lib/odkaz.ts` | Převzít bez rolí. Je to jen pohodlí, skutečná ochrana je na serveru a v databázi. |
| Databáze: RLS na všech tabulkách, prohlížeč nikdy nezapisuje, neveřejné schéma, kontrola 2FA v databázi | `supabase/migrations/20261012000000_zaklad.sql`, `20261012000100_neverejne_funkce.sql` | Napsat jednu novou migraci podle vzoru, s jednou změnou: tabulky mají RLS zapnuté, ale žádnou politiku čtení (oddíl 4, Společná pravidla). Vzor portálu „politika volá pomocnou funkci pro každý řádek“ nepřebíráme, u 90 tisíc řádků by znamenal 90 tisíc volání funkce na dotaz. Kdyby někdy politika čtení přibyla, píše se jako `using ((select private.is_member_2fa()))`, aby se funkce vyhodnotila jednou na dotaz, a funkce vyžaduje `aal2`. |
| Audit log, do kterého se jen přidává | `20261012000000_zaklad.sql` (tabulka `audit_log`, trigger), `src/server/sprava.ts` (ř. 21), `src/routes/admin/audit/+page.svelte` | Převzít a rozšířit o strukturovaná pole (co, které IČO, IP adresa) a o záznam exportů. |
| Tabulka serverových tajemství a odhlášení všude | `supabase/migrations/20261012000200_server.sql` | Převzít jen pro kód plánovače a adresu funkce. API klíče sem nepatří. |
| Založení účtu a obnova hesla z příkazové řádky | `scripts/zalozit-admina.mjs`, `scripts/obnova-hesla.mjs`, `scripts/odkaz-pozvanky.mjs` | Převzít, vyjmout natvrdo zapsané ID projektu. Jediný způsob vzniku účtu. |
| Klient Raynetu: přenosová vrstva a třída chyb | `src/lib/raynet/klient.ts` (ř. 14–72, 101–110) | Převzít. Doplnit dotazové parametry, stránkování, `totalCount`, čtení hlaviček limitu. Metody pro zápis leadů vypustit. Čtení leadů se doplní jen tehdy, když odpověď na otázku 8.2 č. 20 řekne, že předání od operátorky je v Raynetu lead. |
| Čtení podle ID, kde 404 znamená „není“ | `src/server/raynet.ts` (ř. 38–46) | Převzít, přidat sourozence pro stránkované seznamy. |
| Čtení číselníku fází OP | `src/server/raynet.ts` (ř. 60–68) | Vzor pro další číselníky (důvody prohry, kategorie aktivit). |
| Mapování stavů OP a přepis názvů fází | `src/lib/raynet/stavy.ts`, `stavy.test.ts` | Převzít logiku, mapu přesunout do nastavení. |
| Rozvrh opakování po chybě | `src/lib/raynet/fronta.ts` | Převzít funkce, prodlevy předávat z nastavení. |
| Vzor zpracování fronty a zkušební režim („nasucho“) | `src/server/sprava.ts` (ř. 157–209, 276–294) | Převzít vzor, ne kód. Zkušební režim poslouží jako náhled před hromadným zápisem. |
| Log volání konektoru | `20261012000000_zaklad.sql` (ř. 164–173) | Vzor pro nový log po jednotlivých voláních, bez osobních údajů. |
| Plánovač: pg_cron + pg_net volá funkci `api` s tajnou hlavičkou | `20261018100000_stavy_z_raynetu.sql` (ř. 17–44), `20261018100100_planovac_fronta.sql`, `src/server/obsluha.ts` (ř. 132–150) | Převzít celé včetně triku s pražským časem. Adresu funkce nastavit na nový projekt. |
| ARES: adresa, časový limit, stavy odpovědi | `src/lib/ares/ares.ts`, `ares.live.test.ts` | Převzít základ. Dávkový dotaz po 100 IČO a mapování kraje, okresu, NACE, data vzniku a právní formy napsat nově. |
| Validace IČO a telefonu | `src/lib/domain/validace.ts`, `validace.test.ts` | Kontrolní součet IČO a převod telefonu na tvar +420… převzít beze změny. Normalizaci IČO pro import napsat nově: portál chybějící úvodní nuly jen hlásí a vstup delší než 8 číslic tiše ořízne (OVĚŘENO v `validace.ts`). Import číselnou buňku s 1–7 číslicemi doplní zleva nulami na 8 a teprve pak ověří kontrolním součtem. Více než 8 číslic je chyba, neořezává se. Jak jsou IČO v kmenovém Excelu uložená (číslo, nebo text), se ověří na ukázce. |
| Vzhled: barvy, písma, třídy tabulek, filtrů a hlášek | `src/app.css` | Převzít. Upravit šířku stránky a hustotu tabulek pro práci na monitoru. `DESIGN.md` portálu je zastaralý, platí `app.css`. |
| Obecné komponenty | `src/lib/components/Tlacitko.svelte`, `Pole.svelte`, `Prepinac.svelte`, `PotvrzeniAkce.svelte`, `Displej.svelte` | Převzít. `PotvrzeniAkce` se hodí na potvrzení placené dávky a zápisu do Raynetu. |
| Vzory obrazovek | `src/lib/components/StavTipu.svelte`, `DetailTipu.svelte`, `src/routes/admin/tipy/+page.svelte`, `src/routes/admin/audit/+page.svelte` | Jen jako vzor (tečka + text stavu, svislá časová osa, filtry v adrese). Přepsat. |
| Formátování a CSV | `src/lib/format.ts`, `src/lib/csv.ts` | Převzít. Datum upravit na přesný tvar DD. MM. RRRR. |
| Hlavičky zabezpečení a noindex | `static/_headers`, `static/robots.txt`, `src/app.html` | Převzít. V CSP nastavit adresu nového projektu, ARES z prohlížeče nevolat. |
| Nasazení: kontrola, testy, build, web a funkce | `.github/workflows/nasazeni.yml`, `.github/workflows/migrace.yml`, `scripts/build-api.mjs`, `package.json`, `svelte.config.js`, `wrangler.toml`, `vite.config.ts` | Převzít. Názvy projektů dát do proměnných repozitáře. Migrace zůstávají ruční s náhledem (schváleno). |
| Úvodní zprovoznění jedním skriptem | `scripts/zprovozneni.sh` | Převzít a upravit. Běží jen na Macu, potřebuje přihlášení v prohlížeči. |
| Testy zabezpečení | `supabase/tests/izolace.sql`, `scripts/test-serveru.mjs` | Převzít vzor. Přidat test, který projde všechny tabulky a ověří, že mají RLS. |
| Testy klienta Raynetu s falešným serverem | `src/lib/raynet/klient.test.ts`, `klient.ostry.test.ts` | Převzít pomocníka. Ostré testy psát jen pro čtení. |

**Co nepřebíráme:** starou funkci `supabase/functions/raynet-lead` (volatelná kýmkoli s veřejným klíčem), uložení klíče Raynetu v databázi, testovací režim v paměti prohlížeče (90 tisíc řádků neunese), role a partnery, e-mailové pozvánky, `src/lib/konfigurace.ts` s natvrdo zapsanou adresou projektu.

**Co v portálu chybí a postavíme nově:** stránkování a filtrování na serveru, čtení a zápis Excelu, obecná fronta úloh, čtení seznamů z Raynetu, vlastní pole Raynetu, hlídání denního limitu, dávkový ARES, CheckMobi, zálohy.

---

## 3. Architektura

### 3.1 Jak to drží pohromadě

1. **Prohlížeč** zobrazuje obrazovky a čte i zapisuje Excel. Do databáze přímo nezapisuje nikdy.
2. **Funkce `api`** (Supabase Edge Function) je jediná cesta k datům: jedno volání `POST { method, args }`, pevný seznam povolených metod, kontrola přihlášení a 2FA před každou metodou. Tato vrstva je to „vlastní API“, které půjde později připojit k vlastnímu CRM.
3. **Databáze** (Postgres v Supabase, Frankfurt) drží data, nastavení, frontu úloh a historii.
4. **Plánovač** (pg_cron) každou minutu zavolá funkci `api`, ta odbaví kousek fronty (ARES, CheckMobi, Raynet) a skončí. Jednou denně v noci spustí denní pravidla (checkpointy, úkoly, konec karantén, návraty plováků).
5. **Obchodní pravidla** jsou čisté funkce ve složce `src/lib/domain`. Nesahají na databázi ani na síť, dostanou data a nastavení a vrátí výsledek. Díky tomu se dají testovat a přenést do budoucího CRM.

### 3.2 Moduly

| Modul ze zadání | Modul v kódu | Obrazovky | Hlavní tabulky |
|---|---|---|---|
| 1. Master databáze IČO | `companies` | Seznam IČO, detail IČO s historií, import, export | `companies`, `company_phones`, `company_state_history`, `company_assignments`, `imports` |
| 2. Předfiltr | `prefilter` | Předfiltr (ARES, CheckMobi, náhled ceny), uložené filtry | `jobs`, `job_batches`, `checkmobi_lookups`, `saved_filters` |
| 3. Dávky a robot | `cohorts` | Seznam dávek, detail dávky s časovou osou, generátor souborů, import výsledku | `cohorts`, `cohort_members`, `cohort_events`, `robot_files`, `file_templates` |
| 4. Siebel | `siebel` | Kontroly vlastníka a přeblokace, import výstupu | `siebel_runs`, `siebel_run_items` |
| 5. Semafor | `semaphore` | Přehled dávky podle barev, detail s odůvodněním, fronta oranžových | `semaphore_evaluations` |
| 6. Důvody prohry | `loss-rules` | Návrhy akcí podle prohry, plováky, karantény | `loss_rules`, `release_rules`, `loss_outcomes` |
| 7. Přidělování a rotace | `allocation` | Přidělení, obsazenost loginů, obchodníci | `sales_reps`, `company_assignments` |
| 8. Úkoly pro vedení | `tasks` | Úkoly, dashboard | `tasks` |
| 9. Měření | `metrics` | Trychtýř podle kohorty a kanálu | pohledy nad `cohort_members` |
| Integrace Raynet | `integrations/raynet` | Stav synchronizace, náhled zápisů, log volání | `raynet_*`, `api_call_log` |
| Společné | `auth`, `settings`, `audit`, `jobs` | Přihlášení, Nastavení, Audit log, Úlohy na pozadí | `users`, `settings`, `state_transitions`, `audit_log`, `secrets` |

Pravidlo závislostí: moduly spolu mluví jen přes své veřejné funkce. Modul `semaphore` nezná Raynet, zná jen zrcadlové tabulky. Modul `siebel` nezná Excel, zná jen rozhraní brány (oddíl 5.4).

### 3.3 Struktura složek

```
docs/                       zadání, tento návrh, později popisy podkladů
src/
  app.css, app.html         vzhled a kostra stránky (noindex)
  routes/                   obrazovky (české adresy)
    prihlaseni/  prehled/  ico/  ico/[ico]/  import/  predfiltr/
    davky/  davky/[id]/  semafor/  duvody-prohry/  siebel/
    pridelovani/  ukoly/  mereni/  nastaveni/  audit/
  lib/
    components/             společné prvky UI (tabulka, filtr, nahrání souboru, průběh)
    api/                    volání funkce api, typy metod po modulech
    excel/                  čtení a zápis xlsx v prohlížeči, mapování sloupců
    domain/                 čistá obchodní pravidla, bez databáze a sítě
      ico/                  validace, stavový automat
      prefilter/  cohorts/  semaphore/  loss-rules/
      allocation/  tasks/  metrics/
    integrations/           klienti vnějších systémů, bez závislosti na serveru
      raynet/  ares/  checkmobi/  siebel/
  server/                   kód funkce api
    entry.ts  handler.ts    vstup, CORS, seznam metod, přihlášení
    base.ts                 kontext požadavku, audit
    modules/                jedna složka na modul z tabulky výše
    jobs/                   fronta úloh a zpracování po typech
supabase/
  migrations/               změny databáze
  functions/api/index.ts    dva řádky, načtou sestavený balík
  tests/                    testy izolace (RLS)
scripts/                    sestavení api, založení účtu, obnova hesla, zprovoznění
static/                     _headers, robots.txt
.github/workflows/          nasazení a migrace
```

Názvy v kódu a v databázi jsou anglicky, texty na obrazovce česky. Hodnoty stavů IČO zůstávají přesně podle zadání (`v_poolu`, `ve_filtru`, …).

---

## 4. Datový model

Společná pravidla pro všechny tabulky:
- Každá tabulka má zapnuté RLS a žádnou politiku, schéma není vystavené prohlížeči. Čtení i zápis jdou jen přes funkci `api`, která po centrální kontrole (aktivní řádek v `users` a relace `aal2`) pracuje servisním klientem. Důvod: s politikou čtení by šlo data stáhnout přímo přes REST rozhraní Supabase mimo audit exportu a politika by se u 90 tisíc řádků vyhodnocovala pro každý řádek. Test izolace ověřuje, že přímý dotaz s platným tokenem `aal2` i `aal1` nevrátí z žádné tabulky ani řádek.
- Stránkovaný seznam v `api` má strop velikosti stránky a pevný výčet vracených polí (obojí v nastavení `list.*`). Hromadné vydání dat jde jen přes export s jednorázovým exportním tokenem, který se zapisuje do audit logu.
- Hromadné zápisy (použití importu, přechod stavu pro celou dávku, import výsledku robota, denní pravidla) běží jako databázové funkce volané přes RPC s vlastním `statement_timeout`, nebo po částech přes frontu `jobs` (limit délky dotazu v oddílu 7).
- Tabulky vedené jako záznam (`audit_log`, `company_state_history`, `cohort_events`) mají trigger, který brání úpravě i mazání řádku, a druhý na úrovni příkazu proti `TRUNCATE`. Platí i pro servisní roli. Cizí klíče z nich na `companies` nemají kaskádové mazání. Test izolace ověřuje, že úprava i smazání selže i servisní rolí.
- `timestamptz` = čas s časovým pásmem, `date` = datum. Sloupce `created_at` mají výchozí hodnotu „teď“.
- PK = primární klíč, FK = odkaz na jinou tabulku, UQ = jedinečná hodnota.
- IČO je vždy `char(8)` s úvodními nulami.

### 4.1 Společné tabulky

**`users`** — dva uživatelé aplikace (whitelist).

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | uuid | PK, FK na `auth.users` |
| email | text | UQ, jen malá písmena |
| first_name, last_name | text | |
| active | boolean | vypnutý účet nevidí nic |
| activated | boolean | má nastavené heslo |
| last_login_at | timestamptz | |
| created_at | timestamptz | |

**`settings`** — obecná nastavení klíč–hodnota (seznam klíčů v oddílu 4.4).

| Sloupec | Typ | Poznámka |
|---|---|---|
| key | text | PK, např. `semaphore.green.min_potential_bmsl` |
| value | jsonb | číslo, text, seznam nebo objekt |
| value_type | text | `number`, `text`, `boolean`, `list`, `map` (pro editor v UI) |
| group_key | text | skupina v UI; index |
| label_cs | text | český popisek |
| help_cs | text | česká nápověda |
| updated_at | timestamptz | |
| updated_by | uuid | FK `users` |

Každá změna nastavení se zapíše do `audit_log` se starou a novou hodnotou.

**`audit_log`** — kdo co změnil nebo exportoval. Jen přidávání, trigger brání úpravě i mazání.

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | bigint | PK, automatické |
| at | timestamptz | index sestupně |
| actor_id | uuid | FK `users`, prázdné u systému |
| actor_name | text | jméno v okamžiku zápisu |
| action | text | např. `company.state_change`, `export.companies`, `settings.update`; index |
| entity | text | např. `company`, `cohort`, `setting` |
| entity_id | text | např. IČO; index (entity, entity_id) |
| description | text | česká věta pro čtení |
| details | jsonb | stará a nová hodnota, filtr exportu, počet řádků |
| ip | text | |
| user_agent | text | |

**`secrets`** — jen pro server (RLS zapnuté, žádná politika). Obsahuje kód plánovače a adresu funkce. API klíče zde nejsou.

| Sloupec | Typ | Poznámka |
|---|---|---|
| key | text | PK |
| value | text | |

**`jobs`** — obecná fronta úloh na pozadí.

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | bigint | PK |
| type | text | `ares_lookup`, `checkmobi_lookup`, `raynet_sync`, `raynet_backfill`, `raynet_write`, `daily_rules`, `import_apply` |
| status | text | `queued`, `running`, `done`, `failed`, `cancelled` |
| priority | smallint | nižší číslo = dřív |
| payload | jsonb | např. seznam až 100 IČO |
| batch_id | bigint | FK `job_batches`; index |
| run_after | timestamptz | kdy nejdřív spustit |
| attempts | smallint | počet pokusů |
| last_error | text | očištěný text chyby, bez telefonů a IČO (pravidlo u `api_call_log`) |
| locked_at | timestamptz | čas převzetí; zámek propadá po `jobs.lock_timeout_minutes` |
| created_at, finished_at | timestamptz | |

Index: (status, run_after, priority).

Převzetí úloh: jedna databázová funkce volaná přes RPC (`update … where id in (select … for update skip locked) returning`) nastaví `running` a `locked_at` v jedné transakci. Zámek řádku sám nestačí, protože drží jen po dobu této transakce a funkce `api` pak s databází mluví po jednotlivých voláních. Když běh skončí násilně (limit procesoru, limit délky běhu, nasazení nové verze), úloha zůstane `running`. Proto stejná funkce vrací do fronty úlohy, jejichž `locked_at` je starší než `jobs.lock_timeout_minutes`, a zvýší jim `attempts`. Každý typ úlohy musí být bezpečně opakovatelný (u CheckMobi viz 5.3). Úlohy typu `raynet_*` si navíc berou poradní zámek (advisory lock), takže proti Raynetu běží vždy jen jeden běh a dva překrývající se běhy nepřekročí `raynet.max_parallel`.

**`job_batches`** — jedna hromadná akce (např. „ARES pro import č. 3“), nese průběh a potvrzení.

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | bigint | PK |
| type | text | jako u `jobs` |
| label | text | český název pro UI |
| total, done, failed | integer | průběh |
| status | text | `preview`, `confirmed`, `running`, `done`, `cancelled` |
| estimate | jsonb | počet volání, odhad ceny, měna |
| confirmed_by | uuid | FK `users` |
| confirmed_at | timestamptz | bez potvrzení se placená ani zápisová dávka nespustí |
| created_by | uuid | FK `users` |
| created_at | timestamptz | |

Potvrzení je jednorázová atomická změna `preview → confirmed` (`update … where status = 'preview'`). Druhé potvrzení téže dávky nic neudělá, takže dvojklik nezařadí úlohy dvakrát.

**`api_call_log`** — log volání vnějších služeb, bez těl požadavků a bez osobních údajů.

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | bigint | PK |
| at | timestamptz | index |
| service | text | `raynet`, `ares`, `checkmobi`; index (service, at) |
| method, path | text | šablona cesty, ne skutečná cesta: `/v1/lookup/mnp/{phone}`, `/company/{id}`. CheckMobi má číslo přímo v cestě, proto se skutečná cesta nikdy neukládá |
| phone_id | bigint | FK `company_phones`, u CheckMobi místo čísla |
| status | integer | HTTP kód, prázdné při síťové chybě |
| duration_ms | integer | |
| items | integer | kolik záznamů volání vrátilo nebo poslalo |
| rate_remaining | integer | hlavička `X-Ratelimit-Remaining` (Raynet) |
| cost | numeric(10,4) | cena z odpovědi (CheckMobi) |
| job_id | bigint | FK `jobs` |
| error | text | zkrácená a očištěná chyba |

Text chyby z vnější služby může číslo nebo IČO zopakovat. Před zápisem do `error` a do `jobs.last_error` se z něj proto odstraní řady 8 a více číslic. Test v kroku 3: po běhu CheckMobi neodpovídá žádný řádek `api_call_log` ani `jobs` vzoru telefonního čísla.

### 4.2 Master databáze a historie

**`companies`** — jedno IČO = jeden řádek.

| Sloupec | Typ | Poznámka |
|---|---|---|
| ico | char(8) | PK |
| name | text | index pro hledání bez diakritiky (trigram) |
| subject_type | text | `FO`, `PO`, prázdné před ověřením; index |
| legal_form_code | text | kód právní formy z ARES |
| region_code, region_name | text | kraj sídla; index na kód |
| district_code, district_name | text | okres; u Prahy doplněno „Praha“ |
| nace_codes | text[] | CZ-NACE z ARES; GIN index |
| founded_on | date | může chybět; index |
| dissolved_on | date | datum zániku |
| ico_valid | boolean | platnost IČO |
| ico_verified_at | timestamptz | datum ověření v ARES |
| state | text | jeden z 12 stavů podle seznamu v oddílu 4.3; index |
| holder_type | text | `superuser`, `login_oz`, `pool`, `jiny_partner`, `neznamo` |
| holder_login | text | Siebel login, název poolu nebo partnera; index (holder_type, holder_login) |
| sales_rep_id | integer | FK `sales_reps`, přiřazený OZ; index |
| owned_from | date | datum od |
| ownership_ends_on | date | datum konce vlastnictví; index. Na superuseru se počítá z `ownership.superuser_*`. Zdroj pro login OZ je otevřený (otázka 8.2 č. 21) |
| cohort_id | integer | FK `cohorts`, aktuální dávka; index |
| channel | text | `operatorka`, `cold_call` |
| rounds_count | smallint | počet kol |
| return_on | date | datum návratu; index |
| return_path | text | cesta návratu: `siebel_check` (kontrola vlastníka, pak přeblokace nebo robot), `robot` (rovnou do dávky pro robota); z `loss_rules.return_path` |
| quarantine_until | date | karanténa do; index |
| never_return | boolean | trvalé vyřazení („nikdy“, důvod 206). Výchozí ne; index. Předfiltr takové IČO nikdy nezařadí a žádný automatický přechod ho nevrátí do `v_poolu`. Zrušit jde jen ručně s poznámkou |
| return_on_overridden | boolean | datum návratu ručně přepsáno |
| return_on_override_note | text | povinná poznámka; CHECK: přepsáno ⇒ neprázdná poznámka |
| quarantine_overridden | boolean | karanténa ručně přepsána |
| quarantine_override_note | text | povinná poznámka; CHECK: přepsáno ⇒ neprázdná poznámka |
| ca_number | text | číslo CA pro přeblokaci, pokud je v podkladech |
| siebel_owner | text | vlastník podle poslední kontroly |
| siebel_opportunity_valid_until | date | platnost nejmladší příležitosti |
| siebel_checked_at | timestamptz | |
| raynet_company_id | bigint | ID firmy v Raynetu; index |
| extra | jsonb | jen ty nenamapované sloupce z Excelu, které uživatel při mapování výslovně zaškrtne. Ostatní se neukládají (v Excelu mohou být jména, e-maily a poznámky bez účelu) |
| created_at, updated_at | timestamptz | |

Ruční přepsání data: každé přepsání zapíše starou a novou hodnotu s poznámkou do `audit_log`, takže druhé přepsání první poznámku neztratí. Vypočtené datum (nový výsledek prohry, noční pravidla) přepsané datum nikdy nenahradí. Změnit ho jde jen novou ruční akcí. Testuje se v kroku 7.

**`company_phones`** — telefony u IČO.

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | bigint | PK |
| ico | char(8) | FK `companies`; index |
| phone | text | tvar +420XXXXXXXXX; UQ (ico, phone) |
| is_primary | boolean | |
| operator | text | `VF`, `O2`, `TM`, `jiny`, prázdné; index |
| operator_mccmnc | text | surový kód sítě |
| operator_verified_at | timestamptz | datum ověření; index |
| number_type | text | mobil, pevná, neplatné |
| source | text | import, ručně, Raynet |

Filtr „operátor ≠ Vodafone“ je podmínka na firmu, operátor je ale u čísla a firma může mít čísel víc. Jak se to sloučí, řídí nastavení `prefilter.operator_match` (oddíl 4.4), ne kód.

**`company_state_history`** — úplný log přechodů stavů a držitelů. Jen přidávání: trigger brání úpravě, mazání i `TRUNCATE` stejně jako u `audit_log` (Společná pravidla).

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | bigint | PK |
| ico | char(8) | FK; index (ico, at) |
| at | timestamptz | |
| from_state, to_state | text | |
| from_holder, to_holder | text | typ + login |
| reason_code | text | strojový důvod (např. `robot_rejected`, `loss_243`) |
| note | text | |
| cohort_id | integer | FK |
| source | text | `import`, `robot`, `siebel`, `semaphore`, `loss_rule`, `allocation`, `manual`, `system` |
| actor_id | uuid | FK `users`, prázdné u systému |

**`company_assignments`** — přidělení OZ s daty od–do.

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | bigint | PK |
| ico | char(8) | FK; index |
| sales_rep_id | integer | FK; index |
| channel | text | |
| source | text | jak přidělení vzniklo: `operator_handover` (lead předaný operátorkou), `cold_call_allocation`, `rotation`, `manual` |
| handed_over_on | date | den předání leadu operátorkou; podle něj se hlídá rovnoměrnost a 7–10 leadů denně. Odkud se událost předání vezme, je otevřené (otázka 8.2 č. 20) |
| round_no | smallint | kolikáté kolo |
| cohort_id | integer | FK |
| assigned_from | date | |
| assigned_to | date | prázdné = trvá |
| end_reason | text | důvod ukončení (kód důvodu prohry, rotace, ruční) |

**`imports`** — každý nahraný soubor.

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | bigint | PK |
| kind | text | `master`, `robot_result`, `siebel_owner_result`, `siebel_overblocking_result` |
| file_name | text | |
| column_mapping | jsonb | mapování sloupců zvolené v UI |
| total_rows, ok_rows, error_rows, duplicate_rows | integer | |
| status | text | `uploading`, `preview`, `applying`, `applied`, `cancelled`. Stav `applying` s `applied_through_row` dovolí přerušený zápis dokončit |
| applied_through_row | integer | po který řádek je import zapsaný |
| cohort_id | integer | FK, u výsledků robota |
| siebel_run_id | integer | FK, u výstupů Siebelu |
| created_by | uuid | FK `users` |
| created_at, applied_at | timestamptz | |

**`import_rows`** — řádky importu před použitím (náhled a report chyb).

| Sloupec | Typ | Poznámka |
|---|---|---|
| import_id | bigint | FK; PK (import_id, row_no) |
| row_no | integer | číslo řádku v Excelu |
| ico | char(8) | po normalizaci, může chybět |
| data | jsonb | namapované hodnoty |
| status | text | `ok`, `error`, `duplicate` |
| error_code | text | např. `ico_checksum`, `ico_length`, `duplicate_in_file` |

Po použití importu se řádky `ok` smažou, chybové zůstanou pro report nejdéle `retention.import_error_rows_days` dní a pak se smažou také (jejich `data` obsahují telefony).

**`saved_filters`** — uložené filtry seznamu a dávek: `id` (PK), `name`, `definition` (jsonb), `created_by`, `created_at`.

### 4.3 Stavový automat

Stavy přesně podle zadání: `v_poolu`, `ve_filtru`, `u_robota_ocisteni`, `superuser`, `login_oz`, `vraceno`, `odvlastneno`, `plovak`, `karantena`, `ztraceno`, `zakaznik`, `neaktivni_ico`.

**`state_transitions`** — povolené přechody. Editovatelná v nastavení (každá změna jde do `audit_log` se starým a novým řádkem), server jiný přechod odmítne.

Každý přechod provádí jedna databázová funkce v jedné transakci: zamkne řádek firmy, ověří, že firma je pořád ve výchozím stavu, se kterým volající počítal (jinak přechod odmítne), ověří přechod proti `state_transitions` včetně povinné poznámky, upraví `companies` a zapíše `company_state_history` a u ručního přechodu `audit_log`. Stav se tak nemůže změnit bez řádku historie a dva souběžné běhy (dva uživatelé, minutový plánovač, noční pravidla, použití importu) nepohnou stejným IČO ze stejného stavu dvakrát. Kontrola limitů (login OZ, superuser) běží uvnitř téže funkce pod poradním zámkem na daný login, takže dvě souběžná přidělení neprojdou obě při stavu 249 z 250. Souběžné testy patří ke krokům 2 a 9.

| Sloupec | Typ | Poznámka |
|---|---|---|
| from_state, to_state | text | PK (from_state, to_state) |
| enabled | boolean | |
| manual_allowed | boolean | smí ho udělat člověk ručně |
| note_required | boolean | ruční přechod vyžaduje poznámku |
| label_cs | text | popis v UI |
| updated_at | timestamptz | |
| updated_by | uuid | FK `users` |

Výchozí obsah tabulky. Sloupec „Zdroj“ říká, jestli přechod plyne přímo ze zadání, nebo je to můj výklad, který potřebuje potvrzení.

| Z | Do | Kdy | Zdroj |
|---|---|---|---|
| `v_poolu` | `ve_filtru` | IČO zařazeno do sestavované dávky | zadání |
| `v_poolu` | `neaktivni_ico` | ARES: zaniklé nebo nenalezené | výklad |
| `ve_filtru` | `u_robota_ocisteni` | Thomas potvrdil nahrání souboru očištění | zadání |
| `ve_filtru` | `v_poolu` | dávka zrušena, IČO z dávky vyřazeno | výklad |
| `ve_filtru` | `neaktivni_ico` | ARES při předfiltru | výklad |
| `u_robota_ocisteni` | `superuser` | výsledek robota: přistálo | zadání |
| `u_robota_ocisteni` | `v_poolu` | výsledek robota: nepřevzato, s důvodem | zadání |
| `v_poolu` | `karantena` | rotace vyčerpána u IČO, které se vrátilo do poolu (maximum kol, prošli všichni OZ) | výklad |
| `superuser` | `login_oz` | zelená, nebo rozhodnutí „Držet“; stav se změní až po potvrzení, že převod v Siebelu proběhl (otázka 8.2 č. 19) | zadání |
| `superuser` | `vraceno` | potvrzené nahrání souboru vrácení statusů | zadání |
| `superuser` | `odvlastneno` | potvrzené nahrání souboru odvlastnění | zadání |
| `superuser` | `zakaznik` | OP vyhraná (deal) | výklad |
| `superuser` | `ztraceno` | kontrola Siebelu: vlastní jiný partner | výklad |
| `superuser` | `neaktivni_ico` | ARES: zaniklo během držení | výklad |
| `login_oz` | `odvlastneno` | pravidlo důvodu prohry, revize, limit; až po potvrzení, že uvolnění v Siebelu proběhlo (otázka 8.2 č. 19) | zadání |
| `login_oz` | `vraceno` | vrácení se statusy | výklad |
| `login_oz` | `zakaznik` | OP vyhraná (deal) | zadání |
| `login_oz` | `ztraceno` | důvod prohry 300 nebo kontrola Siebelu | zadání |
| `login_oz` | `neaktivni_ico` | ARES | výklad |
| `login_oz` | `login_oz` | rotace na jiného OZ (mění se držitel, ne stav) | zadání |
| `vraceno` | `plovak` | má datum návratu | zadání |
| `vraceno` | `karantena` | má karanténu | zadání |
| `vraceno` | `v_poolu` | bez omezení a bez příznaku `never_return` | výklad |
| `odvlastneno` | `plovak` | má datum návratu | zadání |
| `odvlastneno` | `karantena` | má karanténu | zadání |
| `odvlastneno` | `v_poolu` | bez omezení a bez příznaku `never_return` | výklad |
| `vraceno`, `odvlastneno` | `karantena` | příznak `never_return` (trvalé vyřazení, bez data konce) | výklad |
| `plovak`, `karantena`, `vraceno`, `odvlastneno`, `ztraceno`, `u_robota_ocisteni` | `neaktivni_ico` | ARES: IČO zaniklo | výklad |
| `plovak` | `ve_filtru` | návrat přes robota | zadání |
| `plovak` | `superuser` | úspěšná přeblokace na superusera | výklad |
| `plovak` | `login_oz` | úspěšná přeblokace na login OZ | výklad |
| `plovak` | `ztraceno` | jiný partner s platnou příležitostí | výklad |
| `plovak` | `karantena` | dosaženo maxima kol, prošli všichni OZ | zadání |
| `karantena` | `v_poolu` | uplynulo datum karantény (automaticky). Neplatí pro `never_return`: takové IČO datum nemá a z karantény samo nevyjde | zadání |
| `ztraceno` | `v_poolu` | ručně, s poznámkou | výklad |
| `ztraceno` | `plovak` | ručně nastavené datum návratu | výklad |
| `neaktivni_ico` | `v_poolu` | ARES IČO znovu potvrdí | výklad |
| `zakaznik` | `v_poolu` | jen ručně, s poznámkou | výklad |

Každý přechod zapíše řádek do `company_state_history`. Ruční přechod zapíše navíc řádek do `audit_log`.

Poznámky k tabulce:
- Kam jde IČO po `vraceno` nebo `odvlastneno` (plovák, karanténa, pool), určuje u prohrané OP tabulka `loss_rules` a u červené ze semaforu tabulka `release_rules` (obě v oddílu 4.8). Bez řádku v jedné z nich se IČO samo dál neposune a vznikne úkol.
- Plovák se do dávky dostává vlastní cestou `plovak → ve_filtru`, ne výběrem z poolu. `prefilter.blocking_states` platí jen pro výběr z `v_poolu`, cestu plováků neblokuje. Podmínkou je dosažené datum návratu minus `loss.float_lead_months` a u cesty `siebel_check` výsledek kontroly vlastníka.
- Důvod 243 (nekontaktní): zadání říká „Odvlastnit“ a „znovu přes robota za 6 m“. Návrh (výklad, otázka 8.2 č. 15): IČO je po odvlastnění vedené jako `plovak` s `return_path = robot`, tedy bez kontroly vlastníka v Siebelu a bez přeblokace, po 6 měsících jde rovnou do dávky pro robota.

### 4.4 Kde bydlí každé obchodní pravidlo

**A. Tabulka `settings`** — všechny prahy, lhůty a limity ze zadání. Sloupec „Výchozí“ je hodnota ze zadání. Kde zadání číslo neuvádí, je označeno NÁVRH.

| Klíč | Výchozí | Co řídí (odkaz do zadání) |
|---|---|---|
| `limits.superuser_max` | 10 000 | limit superusera (trvale 6 000, dočasně 10 000) |
| `limits.rep_fo_max` | 250 | limit FO na loginu OZ |
| `limits.rep_po_max` | 250 | limit PO na loginu OZ |
| `limits.warning_pct` | 90 | varování od 90 % obsazenosti |
| `ownership.superuser_hold_days` | 30 | superuser drží 1 měsíc |
| `ownership.superuser_extension_days` | 30 | jedno prodloužení na 2 měsíce |
| `ownership.superuser_max_extensions` | 1 | počet prodloužení |
| `ownership.rep_end_source` | neurčeno (dodá Thomas, otázka 8.2 č. 21) | odkud se bere konec vlastnictví na loginu OZ: pevný počet dní zvlášť pro FO a PO (`ownership.rep_fo_days`, `ownership.rep_po_days`), nebo platnost příležitosti z kontroly Siebelu (`siebel_opportunity_valid_until`) |
| `pools.free` | VBCPOOL, SADMIN, OBSPOOL | volné pooly |
| `pools.release_targets` | VBCPOOL, SADMIN | kam se odvlastňuje |
| `pools.quarantine_target` | VBCPOOL | kam jde „odvlastnit + karanténa“ |
| `ares.cache_days` | 90 (NÁVRH) | jak staré ověření ARES se bere za platné |
| `ares.batch_size` | 100 | IČO na jeden dotaz (strop ARES) |
| `ares.requests_per_minute` | 10 (NÁVRH) | tempo dávkových dotazů |
| `ares.single_requests_per_minute` | 60 (NÁVRH) | tempo jednotlivých dotazů pro IČO, která v dávkové odpovědi chybí |
| `ares.fo_legal_forms` | 100–109 (pravidlo portálu) | které právní formy jsou FO |
| `checkmobi.max_age_days` | 180 | čísla s novějším ověřením se nevolají |
| `checkmobi.price_per_lookup` | 0,002 (ceník, potvrdí Thomas) | odhad ceny dávky |
| `checkmobi.currency` | USD | měna odhadu |
| `checkmobi.requests_per_minute` | 120 (NÁVRH) | tempo dávky |
| `checkmobi.operator_map` | 23001 = TM, 23002 = O2, 23003 = VF, ostatní = jiný (ověřit) | převod kódu sítě na operátora |
| `prefilter.excluded_operators` | VF | filtr „operátor ≠ Vodafone“ |
| `prefilter.operator_match` | `any` (NÁVRH, otázka 8.2 č. 22) | jak se operátor čísel sloučí na firmu: `any` = firma se vyřadí, když kterékoli ověřené číslo patří vyloučenému operátorovi; `primary` = rozhoduje jen hlavní číslo; `all` = vyřadí se, jen když jsou u něj všechna čísla |
| `prefilter.blocking_states` | všechny stavy kromě `v_poolu` | filtr „mimo jiné aktivní stavy“ při výběru z poolu; cestu plováků `plovak → ve_filtru` neblokuje (oddíl 4.3) |
| `prefilter.nace_classification` | `czNace` (2025) (NÁVRH) | podle které klasifikace se filtruje obor |
| `cohort.channel_rules` | FO → operátorka, PO a cílové obory → cold call | rozdělení dávky na kanály |
| `cohort.target_nace` | prázdné (dodá Thomas) | cílové obory pro OZ |
| `cohort.day_zero_event` | datum přistání na superuseru (NÁVRH) | od čeho se počítají dny dávky |
| `cohort.day_extension` | 25 | den prodloužení |
| `cohort.day_checkpoint1` | 30 | checkpoint 1 |
| `cohort.day_checkpoint2` | 50 | checkpoint 2 |
| `cohort.day_decisions_from` | 55 | rozhodnutí provedena od |
| `cohort.day_decisions_to` | 58 | rozhodnutí provedena do |
| `cohort.day_deadline` | 60 | deadline |
| `tasks.robot_result_due_days` | 7 | import výsledku robota = nahrání + 7 dní |
| `tasks.orange_decision_due_day` | 53 | termín úkolu „rozhodnout oranžová“ |
| `tasks.other_reason_review_weekday` | pondělí (NÁVRH) | týdenní revize důvodu „Jiná“ |
| `tasks.rep_review_day_of_month` | 1 (NÁVRH) | měsíční revize loginů OZ |
| `review.no_progress_days` | 30 (NÁVRH, otázka 8.2 č. 17) | měsíční revize: převzaté oranžové IČO je „bez posunu“, když se fáze OP nezměnila a neproběhla žádná aktivita déle než tolik dní |
| `review.overdue_activity_grace_days` | 0 (NÁVRH, otázka 8.2 č. 17) | měsíční revize: o kolik dní smí být naplánovaná aktivita po termínu, než se bere jako propadlá |
| `semaphore.green.phases` | JEDNÁME, NABÍDKA | fáze OP pro zelenou |
| `semaphore.green.contact_within_days` | 14 | úspěšný kontakt za posledních 14 dní |
| `semaphore.green.activity_within_days` | 30 | schůzka nebo aktivita do 30 dní |
| `semaphore.green.min_potential_bmsl` | 800 | potenciál pro zelenou |
| `semaphore.orange.silence_days` | 21 | zájem byl, ale ticho déle než |
| `semaphore.orange.postpone_max_months` | 3 | odklad s datem do |
| `semaphore.orange.noncontact_min_potential_bmsl` | 800 | nekontaktní, ale s potenciálem |
| `semaphore.orange.stalled_days` | 30 | OP bez posunu déle než |
| `semaphore.orange.competitor_commitment_months_min` | 3 | závazek u konkurence končí od |
| `semaphore.orange.competitor_commitment_months_max` | 6 | závazek u konkurence končí do |
| `semaphore.orange.decision_days` | 3 | člověk rozhodne do 3 dnů |
| `semaphore.red.max_potential_bmsl` | 500 | potenciál pod touto hodnotou je červená |
| `semaphore.fallback_color` | oranžová (NÁVRH) | IČO, na které nesedí žádné pravidlo (např. potenciál 500–799) |
| `semaphore.thomas_decides_above_bmsl` | 2 000 | nad touto hodnotou rozhoduje Thomas |
| `semaphore.thomas_decides_rep_fill_pct` | 90 | login OZ nad 90 % limitu → rozhoduje Thomas |
| `semaphore.default_action` | pustit | akce bez rozhodnutí do termínu |
| `semaphore.require_planned_activity` | ano | „Držet“ platí jen s naplánovanou aktivitou |
| `semaphore.signal_map` | prázdné (dodá Thomas) | co v Raynetu znamená úspěšný kontakt, potvrzený zájem, nezájem, odklad, nikdy nezvedl, lead otevřený a nezpracovaný (kategorie aktivity, její výsledek, stav, vlastní pole) |
| `semaphore.max_sync_age_hours` | 24 (NÁVRH) | jak stará smí být poslední úspěšná synchronizace firem a aktivit, aby se směl spočítat checkpoint nebo použít výchozí akce „pustit“ |
| `semaphore.inputs_retention_days` | 365 (NÁVRH) | po jaké době se ze `semaphore_evaluations` smaže snímek vstupů (`inputs`); barva, důvody a rozhodnutí zůstávají |
| `semaphore.potential_source` | neurčeno (dodá Thomas) | odkud se bere potenciál v BMSL |
| `semaphore.color_labels` | Zelená, Oranžová, Červená | hodnoty zapisované do pole Semafor |
| `loss.fo_hold_max_months` | 3 | FO se drží jen při návratu do 3 měsíců. Platí nad všemi pravidly držení v `loss_rules`: když pravidlo říká „držet“, ale jde o FO s návratem dál, použije se `fallback_action` řádku (oddíl 4.8) |
| `loss.float_lead_months` | 3 (zadání: 2–3) | jak dlouho před návratem jde plovák do kontroly |
| `rotation.max_rounds` | 3 | maximum kol |
| `rotation.never_same_rep_reasons` | 243 + „nezájem“ (ID dodá Thomas) | důvody, po kterých IČO nejde k OZ, který ho měl |
| `rotation.exhausted_action` | rozhodnutí Thomase (NÁVRH) | co s IČO, které prošlo všechny OZ: `rozhodnuti` (vznikne úkol `rotation_decision`), nebo `karantena` |
| `rotation.exhausted_quarantine_months` | 12 (NÁVRH, otázka 8.2 č. 25) | délka karantény po vyčerpané rotaci |
| `allocation.operator_leads_per_day_min` / `_max` | 7 / 10 | leady od operátorky na den |
| `raynet.custom_fields` | prázdné (dodá Thomas) | klíče polí Kohorta, Semafor, Rozhodnutí o vlastnictví, Konec vlastnictví, Konec závazku, operátor. Nastavení určuje jen klíč pole. Která role pole se smí zapisovat, je pevně na serveru (čtyři pole ze zadání); Konec závazku a operátor zapsat nejde, ani kdyby se nastavení změnilo |
| `raynet.decision_values` | Držet, Pustit | hodnoty pole Rozhodnutí o vlastnictví |
| `raynet.phase_map` | prázdné (načte se z číselníku) | ID fází OP → JEDNÁME, NABÍDKA, … |
| `raynet.daily_budget` | 12 000 (NÁVRH) | strop volání aplikace za den |
| `raynet.reserve_remaining` | 6 000 (NÁVRH) | pod tímto zůstatkem instance se aplikace zastaví |
| `raynet.daily_write_cap` | 6 000 (NÁVRH) | strop zápisů za den |
| `raynet.daily_backfill_cap` | 2 000 (NÁVRH) | strop dočítání historie za den |
| `raynet.cohort_entry_backfill_cap` | 12 000 (NÁVRH) | jednorázový strop dočítání ve dnech, kdy na superusera přistane celá dávka (místo běžného stropu, v rámci `raynet.daily_budget`) |
| `raynet.max_parallel` | 2 | souběžná spojení (Raynet povolí 4) |
| `raynet.sync_interval_minutes` | 15 (NÁVRH) | jak často se čtou změny |
| `raynet.sync_hours` | 6–20 (NÁVRH) | kdy se čtou změny |
| `raynet.cursor_overlap_minutes` | 5 (NÁVRH) | překryv, aby neunikly změny ve stejné minutě |
| `raynet.retry_delays_minutes` | 1, 5, 15, 60, 240 | opakování po chybě (z portálu) |
| `metrics.excluded_raynet_user_ids` | prázdné (ID uživatele „David“ se dohledá v číselníku uživatelů Raynetu v kroku 5) | vlastníci OP vyřazení z měření. Jediný zdroj pravidla: seznam ID uživatelů Raynetu, v UI zobrazený jménem. Bývalý OZ nemusí být v `sales_reps` vůbec |
| `metrics.stage_map` | prázdné (dodá Thomas) | co znamená „dovoláno“ |
| `logs.api_call_retention_days` | 90 (NÁVRH) | jak dlouho držet log volání |
| `logs.cron_run_retention_days` | 7 (NÁVRH) | jak dlouho držet záznamy běhů plánovače (`cron.job_run_details`) |
| `jobs.lock_timeout_minutes` | 10 (NÁVRH) | po jaké době se úloha ve stavu `running` vrátí do fronty |
| `list.max_page_size` | 200 (NÁVRH) | strop velikosti stránky seznamu v `api` |
| `retention.import_error_rows_days` | 30 (NÁVRH) | jak dlouho držet chybové řádky importu |
| `retention.raynet_mirror_days_after_play` | 90 (NÁVRH) | jak dlouho držet OP, aktivity a nabídky v zrcadle poté, co IČO vypadlo ze hry |
| `backup.max_age_hours` | 26 (NÁVRH) | dashboard varuje, když je poslední úspěšná záloha starší |

**B. Vlastní tabulky pravidel** (editovatelné na obrazovce Nastavení):

| Tabulka | Co obsahuje |
|---|---|
| `state_transitions` | povolené přechody stavů (oddíl 4.3) |
| `loss_rules` | tabulka důvodů prohry (oddíl 4.8) |
| `release_rules` | co s červeným IČO podle důvodu červené: vrátit nebo odvlastnit, cílový pool, návrat, karanténa (oddíl 4.8) |
| `file_templates` | vzory souborů pro robota a Siebel: sloupce, pořadí, hodnoty statusů (oddíl 4.5) |
| `sales_reps` | obchodníci: Siebel login, Raynet ID, typ, domovský kraj (oddíl 4.9) |

Všech pět tabulek má sloupce `updated_at` a `updated_by` a každý zápis do nich jde do `audit_log` se starým a novým řádkem, ve stejné transakci jako změna.

### 4.5 Dávky a robot

**`cohorts`** — dávka (kohorta).

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | integer | PK |
| code | text | UQ, čitelný kód dávky (zapisuje se do pole Kohorta v Raynetu) |
| status | text | `draft`, `file_ready`, `at_robot`, `on_superuser`, `closed`, `cancelled`; index |
| filter | jsonb | filtr, kterým byla sestavena |
| target_size | integer | cílová velikost |
| day_zero_on | date | den 0, od něj se počítají termíny |
| extension_on, checkpoint1_on, checkpoint2_on, decisions_from_on, decisions_to_on, deadline_on | date | spočtené termíny (uložené, aby je změna nastavení zpětně nepřepsala) |
| created_by | uuid | FK `users` |
| created_at | timestamptz | |

**`cohort_members`** — IČO v dávce a jeho cesta trychtýřem.

| Sloupec | Typ | Poznámka |
|---|---|---|
| cohort_id | integer | FK; PK (cohort_id, ico) |
| ico | char(8) | FK; index |
| channel | text | `operatorka`, `cold_call` |
| robot_result | text | `landed`, `rejected`, prázdné |
| robot_reject_reason | text | důvod nepřevzetí |
| outcome | text | jak IČO dávku opustilo (login OZ, vráceno, odvlastněno, …) |
| contacted_at, opportunity_at, offer_at, deal_at | date | milníky pro měření, plní synchronizace z Raynetu |
| contacted_by, opportunity_owner_id, offer_owner_id, deal_owner_id | bigint | ID uživatele Raynetu, kterému patří záznam, z něhož milník vznikl. Podle nich pohled měření vyřazuje vlastníky z `metrics.excluded_raynet_user_ids` až při dotazu, takže změna nastavení platí i zpětně |
| opportunity_business_case_id, deal_business_case_id | bigint | ID OP v Raynetu, ze které milník vznikl |
| offer_value_bmsl | numeric | |

Částečný jedinečný index zajišťuje, že IČO je nejvýš v jedné neuzavřené dávce (stav dávky jiný než `closed` a `cancelled`). Dva souběžně sestavované návrhy dávky tak nedostanou stejné IČO z `v_poolu`.

**`cohort_events`** — časová osa dávky: `id` (PK), `cohort_id` (FK, index), `kind` (`created`, `file_downloaded`, `uploaded_to_robot`, `result_imported`, `extension`, `checkpoint1`, `checkpoint2`, `decisions_done`, `deadline`), `happened_on` (date), `actor_id`, `note`.

**`robot_files`** — vygenerovaný soubor pro robota.

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | integer | PK |
| cohort_id | integer | FK; index. Prázdné u souboru mimo dávku (uvolnění IČO z loginů OZ podle důvodů prohry, revize, limitu) |
| purpose | text | `cohort` (soubor dávky), `loss_rules`, `rep_review`, `limit`, `manual` |
| mode | text | `ocisteni`, `prodlouzeni`, `vraceni_statusu`, `odvlastneni` |
| target_pool | text | u odvlastnění |
| template_id | integer | FK `file_templates` |
| row_count | integer | |
| generated_by | uuid | FK `users` |
| generated_at, downloaded_at | timestamptz | |
| uploaded_on | date | datum nahrání do robota, potvrzuje Thomas |
| result_import_id | bigint | FK `imports` |

**`robot_file_items`** — které IČO v souboru bylo a s jakým statusem: `file_id` + `ico` (PK), `status_value` (text).

Akce s vlastnictvím mimo soubor dávky (NEOVĚŘENO, otázka 8.2 č. 19): zadání zná jen 4 režimy robota a žádný z nich není převod na login OZ. Jak se fyzicky provede převod `superuser → login OZ` (zelená, „Držet“) a jak uvolnění IČO z loginu OZ (odvlastnit, plovák, odvlastnit + karanténa), návrh neví. Do odpovědi platí: aplikace takové akce sbírá do seznamu, vygeneruje k nim soubor nebo přehled (soubor robota s prázdným `cohort_id`, pokud to robot z loginu OZ umí), založí úkol (`oz_transfer`, `oz_release`) a stav IČO změní až poté, co Thomas provedení potvrdí. Stejně jako u vrácení a odvlastnění ze superusera.

**`file_templates`** — vzory souborů, bez zásahu do kódu.

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | integer | PK |
| kind | text | UQ; `robot_ocisteni`, `robot_prodlouzeni`, `robot_vraceni_statusu`, `robot_odvlastneni`, `robot_result`, `siebel_vlastnik_in`, `siebel_vlastnik_out`, `siebel_preblokace_in`, `siebel_preblokace_out`, `master_import` |
| direction | text | `out` (generujeme), `in` (importujeme) |
| sheet_name | text | název listu |
| header_row | integer | řádek se záhlavím |
| columns | jsonb | seznam: záhlaví sloupce, zdrojové pole, pevná hodnota, formát |
| value_maps | jsonb | převody hodnot, např. důvod → návratový status robota, text výsledku → přistálo / nepřevzato |
| updated_at | timestamptz | |
| updated_by | uuid | FK `users` |

### 4.6 Siebel

**`siebel_runs`** — jedna kontrola vlastníka nebo jedna várka přeblokací.

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | integer | PK |
| kind | text | `owner_check`, `overblocking` |
| gateway | text | `file` (dnes), později `api` |
| status | text | `created`, `input_downloaded`, `result_imported`, `cancelled` |
| purpose | text | proč vznikla (návrat plováků, kontrola dávky, ručně) |
| task_id | bigint | FK `tasks` |
| result_import_id | bigint | FK `imports` |
| created_by | uuid | FK `users` |
| created_at, input_downloaded_at, result_imported_at | timestamptz | |

**`siebel_run_items`** — IČO ve várce.

| Sloupec | Typ | Poznámka |
|---|---|---|
| run_id | integer | FK; PK (run_id, ico) |
| ico | char(8) | FK; index |
| ca_number | text | přeblokace |
| original_owner, requested_owner | text | přeblokace |
| scenario | text | přeblokace, dnes jen A |
| result_owner | text | zjištěný vlastník |
| result_opportunity_valid_until | date | platnost nejmladší příležitosti |
| result_status | text | status z výstupu skillu |
| result_note | text | |

### 4.7 Semafor

**`semaphore_evaluations`** — výsledek checkpointu nebo měsíční revize pro jedno IČO.

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | bigint | PK |
| cohort_id | integer | FK; UQ (cohort_id, ico, kind, review_on), prázdné `review_on` se bere jako shodné |
| ico | char(8) | FK; index |
| kind | text | `checkpoint1`, `checkpoint2`, `review` (měsíční revize loginů OZ) |
| review_on | date | den revize; prázdné u checkpointů. Převzaté oranžové IČO tak může mít každý měsíc nové vyhodnocení a spadnout do červené |
| computed_color | text | `zelena`, `oranzova`, `cervena` |
| final_color | text | po ručním přepsání; index (cohort_id, final_color) |
| reasons | jsonb | které podmínky platí (pro odůvodnění v detailu) |
| inputs | jsonb | snímek jen těch hodnot z Raynetu, které do pravidel skutečně vstoupily (ne celé záznamy); maže se po `semaphore.inputs_retention_days` |
| data_synced_at | timestamptz | stáří dat zrcadla v okamžiku výpočtu; zobrazuje se v detailu |
| history_complete | boolean | historie firmy z Raynetu byla v okamžiku výpočtu dočtená (oddíl 5.1 bod 4); bez ní se barva nepočítá |
| potential_bmsl | numeric | |
| decider | text | `oz`, `thomas` |
| decision | text | `drzet`, `pustit`, prázdné |
| decision_source | text | `raynet_field`, `app`, `default` |
| decision_due_on | date | |
| decided_at | timestamptz | |
| decided_by | uuid | FK `users` (u rozhodnutí v aplikaci) |
| planned_activity_ok | boolean | má OZ v Raynetu naplánovanou aktivitu s datem |
| override_note | text | povinná poznámka k ručnímu přepsání barvy |
| override_by | uuid | FK `users` |
| computed_at | timestamptz | |

CHECK: `final_color <> computed_color` ⇒ neprázdné `override_note` a `override_by`. Rozhodnutí oranžové v aplikaci i přepsání barvy jdou do `audit_log`.

Čerstvost dat: před výpočtem checkpointu, před měsíční revizí a před použitím výchozí akce „pustit“ musí být poslední úspěšná synchronizace firem a aktivit mladší než `semaphore.max_sync_age_hours`. Jinak se výpočet odloží, vznikne úkol pro Thomase a IČO se nepustí. Zaseknutá synchronizace (vyčerpaný limit, výpadek, tichý výpadek plánovače) tak nezpůsobí, že se platné rozhodnutí nebo aktivita OZ „neuvidí“ a IČO se uvolní.

Měsíční revize: pro převzatá oranžová IČO na loginech OZ vznikne vyhodnocení `kind = review`. Červená je, když je IČO bez posunu déle než `review.no_progress_days`, nebo má aktivitu propadlou o víc než `review.overdue_activity_grace_days`. Co se s takovým IČO stane dál, určuje `release_rules` (oddíl 4.8).

### 4.8 Důvody prohry

**`loss_rules`** — tabulka ze zadání, jeden řádek na důvod.

| Sloupec | Typ | Poznámka |
|---|---|---|
| losing_category_id | integer | PK, ID z číselníku Raynetu |
| label | text | název důvodu |
| return_mode | text | `months`, `commitment_minus`, `never`, `manual`, `none`, `ignore` |
| return_months | smallint | pro `months` |
| commitment_offset_months | smallint | pro `commitment_minus` (kolik měsíců před koncem závazku) |
| return_path | text | cesta návratu: `siebel_check` (výchozí: kontrola vlastníka, pak přeblokace nebo robot), `robot` (rovnou do dávky pro robota, důvod 243); prázdné, když se IČO nevrací |
| ownership_action | text | `plovak`, `drzet`, `odvlastnit`, `odvlastnit_karantena`, `zapsat_ztraceno`, `ukol`, `ignorovat` |
| hold_above_bmsl | numeric | nad touto hodnotou držet (důvod 122) |
| hold_if_return_within_months | smallint | do kolika měsíců držet, jinak plovák (důvod 123) |
| hold_subject_types | text[] | pro které typy subjektu smí platit „držet“ (`FO`, `PO`); prázdné = oba. U 293 otevřené, otázka 8.2 č. 16 |
| fallback_action | text | akce, když pravidlo říká „držet“, ale držet nejde; výchozí `plovak` |
| quarantine_mode | text | `none` (bez karantény), `months` (podle `quarantine_months`), `permanent` (trvalé vyřazení, nastaví `companies.never_return`) |
| quarantine_months | smallint | délka karantény, jen pro `quarantine_mode = months` |
| active | boolean | |
| updated_at | timestamptz | |
| updated_by | uuid | FK `users` |

Kdy „držet“ platí (pořadí vyhodnocení):
1. Řádek musí držení dovolit: `ownership_action = drzet`, nebo splněná podmínka `hold_above_bmsl`, nebo `hold_if_return_within_months`.
2. Typ subjektu musí být v `hold_subject_types`.
3. Pro FO navíc vždy platí `loss.fo_hold_max_months`: návrat musí být nejpozději za tolik měsíců. Tato podmínka má přednost před body 1 a 2.
4. Když některá podmínka nevyjde, použije se `fallback_action` řádku. Příklad: FO s důvodem 293 a koncem závazku za 10 měsíců se nedrží, jde do plováku s datem návratu konec závazku − 3 m. FO s důvodem 122 nad 1 500 BMSL se nedrží (návrat za 6 měsíců), jde do plováku.

Výchozí řádky:

| ID | Důvod | return_mode | Návrat | ownership_action | Doplněk |
|---|---|---|---|---|---|
| 122 | Konkurence / cena | `months` | 6 | `plovak` | `hold_above_bmsl` = 1 500; `fallback_action` = `plovak`; `quarantine_mode` = `none`; `return_path` = `siebel_check` |
| 292 | Retence | `months` | 18 | `plovak` | `quarantine_mode` = `none`; `return_path` = `siebel_check` |
| 123 | Závazek / nechce řešit | `commitment_minus` | −3 | `plovak` | `hold_if_return_within_months` = 6; `fallback_action` = `plovak`; `quarantine_mode` = `none`; `return_path` = `siebel_check` |
| 293 | Závazek / bude řešeno | `commitment_minus` | −3 | `drzet` | `fallback_action` = `plovak`; `hold_subject_types` = prázdné, dokud Thomas nepotvrdí, jestli „(PO longterm)“ znamená „jen PO“ (otázka 8.2 č. 16); `quarantine_mode` = `none`; `return_path` = `siebel_check` |
| 243 | Nekontaktní | `months` | 6 | `odvlastnit` | `return_path` = `robot` (návrat přes robota, bez kontroly Siebelu); `quarantine_mode` = `none` (výklad, otázky 8.2 č. 10 a 15) |
| 121 | Signál | `months` | 12 | `odvlastnit_karantena` | `quarantine_mode` = `months`, `quarantine_months` = 12 (výklad); `return_path` = `siebel_check` |
| 294 | Služby pod někým jiným / Šeďák / Služebák | `months` | 12 | `odvlastnit_karantena` | `quarantine_mode` = `months`, `quarantine_months` = 12 (výklad); `return_path` = `siebel_check` |
| 206 | Vodafone / již je zákazníkem | `never` | — | `odvlastnit` | `quarantine_mode` = `permanent` (výklad): nastaví `never_return`, IČO se do dávek nevrátí |
| 300 | Ztráta vlastnictví | `none` | — | `zapsat_ztraceno` | `quarantine_mode` = `none` |
| 124 | Jiná | `manual` | — | `ukol` | týdenní úkol pro Thomase |
| 289, 290 | RNW … | `ignore` | — | `ignorovat` | |

ID důvodů jsou ze zadání a proti ostré instanci Raynetu zatím nebyla ověřena (NEOVĚŘENO, ověří se v kroku 5).

**`loss_outcomes`** — co aplikace z jedné prohrané OP odvodila. Každá OP se zpracuje jednou.

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | bigint | PK |
| ico | char(8) | FK; index |
| raynet_business_case_id | bigint | UQ |
| losing_category_id | integer | |
| rule_snapshot | jsonb | pravidlo platné v okamžiku výpočtu |
| computed_action | text | |
| computed_return_on | date | |
| computed_quarantine_until | date | |
| commitment_end_on | date | přečtený konec závazku |
| status | text | `proposed`, `applied`, `needs_input`, `ignored`; index |
| task_id | bigint | FK `tasks` (např. „doplnit konec závazku“) |
| robot_file_id | integer | FK `robot_files`: soubor nebo seznam, kterým se uvolnění z loginu OZ provedlo. Stav `applied` nastane až po potvrzení provedení |
| created_at, applied_at | timestamptz | |

**`release_rules`** — co s červeným IČO, které nemá prohranou OP (a tedy žádný řádek v `loss_rules`). Zadání říká jen „vrátit nebo odvlastnit“, kterou z možností a s jakým návratem, neuvádí.

| Sloupec | Typ | Poznámka |
|---|---|---|
| reason_code | text | PK; důvod červené: `nezajem`, `nezajimavy`, `nekontaktni_nikdy_nezvedl`, `neaktivni_ico`, `nizky_potencial`, `bez_rozhodnuti` (výchozí akce „pustit“), `revize_bez_posunu`, `revize_propadla_aktivita`, `rucne` |
| label | text | český název |
| action | text | `vratit` (vrácení se statusy), `odvlastnit` |
| target_pool | text | u `odvlastnit`, jeden z `pools.release_targets` |
| return_status | text | u `vratit`: návratový status robota (hodnoty ze seznamu od Thomase) |
| return_months | smallint | za kolik měsíců se IČO vrací; prázdné = bez data návratu |
| return_path | text | `siebel_check`, `robot` |
| quarantine_mode | text | `none`, `months`, `permanent` |
| quarantine_months | smallint | |
| updated_at | timestamptz | |
| updated_by | uuid | FK `users` |

Výchozí řádky neuvádím, zadání je nedává: dodá Thomas (otázka 8.2 č. 18). Bez vyplněného řádku aplikace červené IČO jen zařadí do seznamu k rozhodnutí, sama ho nevrátí ani neodvlastní. Když má červené IČO zároveň prohranou OP s důvodem z `loss_rules`, má přednost `loss_rules`.

### 4.9 Obchodníci a úkoly

**`sales_reps`** — obchodníci (OZ).

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | integer | PK |
| name | text | |
| siebel_login | text | UQ |
| raynet_user_id | bigint | UQ |
| rep_type | text | `jezdi`, `online` |
| home_region_code | text | domovský kraj (kód ARES) |
| active | boolean | neaktivní nedostává IČO |
| limit_fo, limit_po | integer | prázdné = obecný limit z nastavení |
| created_at, updated_at | timestamptz | |
| updated_by | uuid | FK `users` |

Vyřazení z měření tu není: jediným zdrojem je `metrics.excluded_raynet_user_ids`, aby pravidlo nežilo na dvou místech.

Obsazenost loginu se nepočítá do sloupce, ale dotazem nad `companies` (stav `login_oz`, podle `sales_rep_id` a `subject_type`). Při přidělení se tento dotaz pouští uvnitř přechodové funkce pod poradním zámkem na login (oddíl 4.3), aby dvě souběžná přidělení nepřekročila limit.

**`tasks`** — pracovní seznam vedení.

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | bigint | PK |
| type | text | `robot_upload`, `robot_result_import`, `siebel_run`, `orange_decisions`, `other_reason_review`, `missing_commitment_end`, `rep_monthly_review`, `limit_warning` (osm typů ze zadání) a navíc `oz_transfer` (převést IČO na login OZ), `oz_release` (uvolnit IČO z loginu OZ), `rotation_decision` (rozhodnout IČO s vyčerpanou rotací), `red_decision` (červená IČO bez pravidla v `release_rules`), `stale_data` (odložený výpočet kvůli starým datům z Raynetu) |
| title | text | český název |
| description | text | |
| due_on | date | index (status, due_on) |
| status | text | `open`, `done`, `cancelled` |
| done_at | timestamptz | |
| done_by | uuid | FK `users` |
| done_note | text | např. „nahráno dne …“ |
| cohort_id, robot_file_id, siebel_run_id, sales_rep_id | integer | odkazy podle typu |
| ico | char(8) | u úkolů k jednomu IČO |
| payload | jsonb | počty, odkaz na frontu |
| dedupe_key | text | UQ, aby stejný úkol nevznikl dvakrát |
| created_at | timestamptz | |

### 4.10 Zrcadlo Raynetu

Jen data potřebná pro semafor, důvody prohry a měření. Aplikace je přepisuje při synchronizaci, nejsou „pravdou“.

**`raynet_companies`** — telefonní seznam firem Raynetu (ID ↔ IČO) a čtená pole. U firem mimo hru se ukládá jen `raynet_id`, `ico`, `modified_at`, `synced_at` a `missing_since`. Ostatní sloupce se plní jen při `in_play` a po vypadnutí ze hry se vyprázdní.

| Sloupec | Typ | Poznámka |
|---|---|---|
| raynet_id | bigint | PK |
| ico | char(8) | index; může být prázdné |
| owner_id | bigint | jen ve hře |
| category_id | bigint | kategorie firmy; jen ve hře |
| commitment_end_on | date | vlastní pole Konec závazku; jen ve hře |
| operator_territory | text | operátor (obchodní teritorium); jen ve hře |
| cf_cohort, cf_semaphore, cf_decision | text | aktuální hodnoty našich polí; jen ve hře |
| cf_ownership_end | date | jen ve hře |
| in_play | boolean | IČO je „ve hře“; index |
| history_complete | boolean | starší OP, aktivity a nabídky firmy jsou dočtené (oddíl 5.1 bod 4) |
| modified_at | timestamptz | datum změny v Raynetu |
| synced_at | timestamptz | |
| missing_since | timestamptz | při rekonciliaci nenalezeno (smazáno nebo sloučeno) |

**`raynet_business_cases`** — OP: `raynet_id` (PK), `company_id` (index), `owner_id`, `status` (`B_ACTIVE`, `E_WIN`, `F_LOST`, `G_STORNO`), `phase_id`, `phase_name`, `phase_changed_at`, `losing_category_id`, `estimated_value` (numeric), `valid_from`, `valid_till` (date), `modified_at`, `synced_at`.

**`raynet_activities`** — aktivity: `kind` + `raynet_id` (PK), `company_id` (index), `business_case_id`, `owner_id`, `category_id`, `status`, `result` (text: výsledek aktivity jako kód nebo hodnota z číselníku či vlastního pole, ne volný text), `scheduled_from`, `scheduled_till`, `completed_at` (timestamptz), `modified_at`, `synced_at`. Texty a poznámky aktivit se neukládají. Výsledek aktivity zadání výslovně žádá a stojí na něm „úspěšný kontakt“, „nikdy nezvedl“ i „dovoláno“. Kde přesně ho Raynet drží (stav, kategorie, vlastní pole aktivity), je NEOVĚŘENO a ověří se v kroku 5 spolu s otázkou 8.2 č. 5.

**`raynet_offers`** — nabídky: `raynet_id` (PK), `company_id` (index), `business_case_id`, `owner_id`, `status_id`, `value_bmsl` (numeric), `valid_from` (date), `modified_at`, `synced_at`.

**`raynet_codelists`** — číselníky: `kind` + `raynet_id` (PK), `label`, `synced_at`. Druhy: fáze OP, důvody prohry, kategorie aktivit, kategorie firem, teritoria, uživatelé.

**`raynet_sync_state`** — kam synchronizace došla: `entity` (PK), `cursor_modified_at`, `last_full_at`, `last_run_at`, `last_status`, `last_error`.

**`raynet_writes`** — plánované a provedené zápisy vlastních polí (náhled i historie).

| Sloupec | Typ | Poznámka |
|---|---|---|
| id | bigint | PK |
| batch_id | bigint | FK `job_batches`; index |
| ico | char(8) | |
| raynet_company_id | bigint | UQ (batch_id, raynet_company_id) |
| changes | jsonb | pole → stará a nová hodnota |
| previewed_modified_at | timestamptz | `modified_at` firmy v okamžiku náhledu, pro kontrolu těsně před zápisem |
| status | text | `preview`, `queued`, `done`, `failed`, `skipped` |
| error | text | |
| applied_at | timestamptz | |

**`checkmobi_lookups`** — placené dotazy: `id` (PK), `phone_id` (FK, index), `batch_id` (FK), `requested_at`, `status` (`pending`, `done`, `failed`), `mccmnc`, `network_name`, `cost` (numeric). UQ (phone_id, batch_id). Řádek `pending` vzniká před voláním, takže opakovaná úloha pozná, že se číslo už volalo (oddíl 5.3).

### 4.11 Měření

Bez vlastních tabulek. Pohled `cohort_funnel` nad `cohort_members` a `companies` vrací pro kohortu a kanál počty: IČO → dovoláno → OP → nabídka → deal, s rozdělením podle FO/PO, kraje, oboru a roku založení. Milníky se ukládají do `cohort_members` při synchronizaci, takže měření nezávisí na tom, jak dlouho držíme zrcadlo Raynetu. U každého milníku je uložené ID vlastníka v Raynetu a ID OP. Pohled milník nezapočítá, když jeho vlastník je v `metrics.excluded_raynet_user_ids`. Vyřazení se tedy děje při dotazu, ne při synchronizaci, a změna seznamu opraví i starší čísla. Zadání mluví jen o OP loginu „David“. Jestli se nemají počítat ani jeho aktivity („dovoláno“) a nabídky, je otázka 8.2 č. 24; do odpovědi se vyřazují OP, nabídky i deal, aktivity ne.

---

## 5. Integrace

### 5.1 Raynet

**Fakta (OVĚŘENO z veřejné dokumentace Raynetu):**
- Limit 24 000 volání za den na celou instanci, počítá se od půlnoci UTC. Zůstatek je v hlavičce `X-Ratelimit-Remaining`.
- Nejvýše 4 souběžná spojení „na jednoho klienta“, jinak chyba 429. Co je „klient“ (API uživatel, nebo odchozí adresa), dokumentace neupřesňuje (NEOVĚŘENO, zjistí se v kroku 5). Tipařský portál při kontrole stavů v 0:00 a 15:00 posílá 5 požadavků souběžně (OVĚŘENO v `src/server/sprava.ts`), tedy je sám nad limitem.
- Seznamy se stránkují po nejvýše 1 000 záznamech.
- Každý seznam umí filtr „změněno od“ (`rowInfo.lastModifiedAt`).
- Hledání firmy podle IČO: návrh počítá s jedním IČO na dotaz. Že hromadné hledání neexistuje, je NEOVĚŘENO: filtry Raynetu mají podle dokumentace operátor `IN`. Jestli ho umí pole IČO firmy (`regNumber[IN]`) a odkaz na firmu u OP, aktivit a nabídek (`company[IN]`), se vyzkouší v kroku 5. Kdyby fungoval, dočtení historie půjde po desítkách firem na jedno volání.
- Vlastní pole se čtou i zapisují v objektu `customFields` firmy. Zápis je jedno volání na firmu, hromadný zápis neexistuje.
- Existují webhooky (upozornění na změnu). V první verzi je nepoužijeme.

**NEOVĚŘENO proti ostré instanci** (ověří se na začátku kroku 5, jen čtením, se souhlasem Thomase): skutečný denní limit instance, klíče vlastních polí, ID důvodů prohry a fází, kde je uložená hodnota v BMSL, kde je uložený výsledek aktivity, filtr nabídek podle firmy, operátor `IN` ve filtrech, co se počítá jako „klient“ u limitu souběžnosti. A hlavně: jestli úprava firmy s částečným objektem `customFields` ostatní vlastní pole zachová, nebo je přepíše prázdnou hodnotou. To se ověří na jedné zkušební firmě dřív, než proběhne první zápis (krok 6). Kdyby Raynet objekt nahrazoval, každý zápis by smazal Konec závazku, operátora a další pole, a zápis by musel posílat všechna vlastní pole firmy načtená těsně předtím.

**Čtení a synchronizace**

Hledat 10–12 tisíc IČO po jednom by stálo 12 000 volání, polovinu denního limitu. Proto:

1. **Seznam firem** (úroveň A): aplikace stáhne celý seznam firem Raynetu po 1 000 a spáruje IČO u sebe. U firem mimo hru ukládá jen ID, IČO a datum změny. Vlastníka, kategorii, konec závazku a vlastní pole ukládá jen u IČO ve hře. Počet firem v Raynetu neznám, při 30 000 firmách je to 30 volání. **Odchylka od zadání ke schválení (otázka 8.2 č. 23):** zadání říká synchronizovat jen IČO ve hře. Seznam ID ↔ IČO všech firem je výjimka kvůli ceně volání (hledání po jednom IČO by stálo polovinu denního limitu). Kdyby v kroku 5 fungoval filtr `regNumber[IN]`, seznam všech firem odpadne a bude se hledat jen IČO ve hře.
2. **Detaily jen pro IČO ve hře** (úroveň B): OP, aktivity a nabídky se ukládají jen pro IČO ve stavu `superuser`, `login_oz` a pro plováky s návratem do `loss.float_lead_months`. To odpovídá zadání i zásadě nedržet víc osobních údajů, než je třeba.
3. **Inkrementálně**: každých 15 minut v pracovní době jedno volání na každý ze čtyř seznamů (firmy, OP, nabídky, aktivity) s filtrem „změněno od poslední synchronizace minus 5 minut“. Záznamy firem mimo hru se zahodí.
4. **Dočtení historie**: když IČO vstoupí do hry a v Raynetu už má starší historii (typicky vracející se plovák), zařadí se úloha, která dočte jeho OP, aktivity a nabídky (až 3 volání na firmu). Aplikace předem nepozná, která firma starší historii má, takže dočítá u všech IČO ve hře, která v seznamu firem Raynetu existují. Při běžném stropu 2 000 volání denně je to asi 650 firem za den. Dávka 4 000 IČO, jejichž firmy už v Raynetu jsou, znamená až 12 000 volání, tedy 6 dní. Proto: ve dnech vstupu dávky platí vyšší jednorázový strop `raynet.cohort_entry_backfill_cap` (dávka se dočte za 1–2 dny v rámci denního rozpočtu), firma má do dočtení příznak `history_complete = ne`, detail IČO ukazuje „historie z Raynetu ještě nedočtena“ a semafor nad takovým IČO barvu nepočítá. Do checkpointu 1 (den 30) se dočtení vejde s velkou rezervou.
5. **Týdenní rekonciliace**: jednou týdně v noci znovu celý seznam firem, aby se poznala smazání a sloučení firem (ta se ve filtru „změněno od“ neobjeví).
6. **Číselníky** (fáze, důvody prohry, kategorie aktivit, uživatelé) jednou denně.

**Rozpočet volání** (výchozí hodnoty z nastavení, vše NÁVRH):

| Položka | Výpočet | Volání za den |
|---|---|---|
| Inkrementální čtení | 56 běhů (6–20 h po 15 min) × 4 seznamy, občas druhá stránka | asi 300 |
| Číselníky | 8 číselníků × 1 | 8 |
| Týdenní rekonciliace firem | počet firem / 1 000, jen jednou týdně | asi 30 |
| Dočtení historie | strop `raynet.daily_backfill_cap`, 3 volání na firmu = asi 650 firem denně | nejvýše 2 000 |
| Zápis vlastních polí | strop `raynet.daily_write_cap`, 1 volání na firmu | nejvýše 6 000 |
| **Součet v nejhorším běžném dni** | | **asi 8 400** |
| Den vstupu dávky | dočtení až do `raynet.cohort_entry_backfill_cap` místo 2 000; dočtení i zápis se dělí o `raynet.daily_budget`, fronta zbytek odloží na další den | nejvýše 12 000 |
| Strop aplikace `raynet.daily_budget` | | 12 000 |
| Zbývá ostatním (tipařský portál, konektor Raynet v Claude, jiné) | 24 000 − 12 000 | 12 000 |

Běžný den bez hromadného zápisu spotřebuje několik set volání. Tipařský portál spotřebuje podle svého kódu nejvýše asi 1 200 volání denně na kontrolu stavů plus odesílání leadů.

Pojistky: před každým během fronta přečte poslední `X-Ratelimit-Remaining`. Pod `raynet.reserve_remaining` se čtení i zápis zastaví do dalšího dne a vznikne varování. Aplikace počítá vlastní volání z `api_call_log`, cizí volání pozná jen z hlavičky.

Jednorázové první naplnění (všechny firmy, OP a aktivity po stránkách) vyjde řádově na stovky volání a pustí se v noci.

**Zápis**

- Zapisují se jen čtyři pole: Kohorta, Semafor, Rozhodnutí o vlastnictví (aplikace ho jen čte, a po uzavření dávky vyprázdní, pokud to Thomas bude chtít), Konec vlastnictví. Nic jiného, žádné štítky.
- Všechna změněná pole jedné firmy jdou jedním voláním.
- Postup: aplikace sestaví náhled (firma, pole, stará → nová hodnota, počet volání, zbývající denní rozpočet) → Thomas potvrdí → řádky jdou do fronty → fronta je odbavuje nejvýše 2 souběžně → výsledek každého řádku je vidět v `raynet_writes`.
- Pojistky zápisu:
  - Potvrzení je jednorázová změna `preview → confirmed`. V jedné dávce je firma nejvýš jednou (UQ `batch_id`, `raynet_company_id`). Novou zápisovou dávku nejde založit pro firmy, které jsou v jiné neuzavřené dávce.
  - Těsně před zápisem se firma znovu načte (nebo se porovná `modified_at` s hodnotou z náhledu). Když se aktuální hodnota zapisovaného pole liší od „staré“ hodnoty z náhledu, řádek se nezapíše a dostane stav `skipped`. Týká se hlavně pole Rozhodnutí o vlastnictví, které vyplňuje OZ: vyprázdnění po uzavření dávky nesmí smazat rozhodnutí zapsané až po náhledu. Nové čtení stojí jedno volání na firmu navíc a počítá se do rozpočtu.
  - Server zapisuje jen čtyři role polí ze zadání bez ohledu na obsah nastavení `raynet.custom_fields`.
  - První zápis proběhne až po ověření, jak Raynet zachází s částečným objektem `customFields` (viz NEOVĚŘENO výše).
- Jedna dávka 4 000 IČO: zápis Kohorty a Konce vlastnictví = 4 000 volání, to je 17 % denního limitu instance. Při asi 100 voláních za minutu trvá 40 minut. Zápis Semaforu na checkpointu 2 pro zbylá IČO je menší.
- Chyby: dočasná chyba (síť, 5xx, 429) se opakuje podle `raynet.retry_delays_minutes`. Trvalá chyba (4xx) zůstane ve frontě jako chyba k ruční kontrole. Raynet někdy vrací chybu dat jako 500, proto po pěti pokusech úloha končí a neopakuje se donekonečna.
- Firmy, které v Raynetu neexistují, aplikace nezakládá. Ukáže je v náhledu jako „v Raynetu chybí“.

**Rozhodnutí oranžových od OZ**: pole Rozhodnutí o vlastnictví se čte při běžné synchronizaci firem. „Držet“ se uzná jen tehdy, když má firma v zrcadle naplánovanou nedokončenou aktivitu s datem v budoucnu. Vyhodnocuje se jen nad čerstvým zrcadlem (`semaphore.max_sync_age_hours`, oddíl 4.7). Při starých datech se rozhodnutí neodmítne ani nepoužije výchozí „pustit“, výpočet se odloží.

**Přístup**: klíč, uživatel a název instance Raynetu budou v tajemstvích serverové funkce. Denní limit se počítá na instanci, takže samostatný API uživatel rozpočet nezvětší. Doporučuji ho přesto: limit 4 souběžných spojení platí na klienta, a kdyby aplikace sdílela API uživatele s portálem, její 2 spojení by se přičetla k 5 spojením portálu při kontrole stavů v 15:00 (uvnitř `raynet.sync_hours`) a obě aplikace by dostávaly 429. Vlastní uživatel navíc usnadní dohledání, kdo co volal. Jestli vlastní uživatel souběžnost opravdu oddělí, se ověří v kroku 5. O uživateli rozhodne Thomas (podklad ke kroku 5).

### 5.2 ARES

**Fakta (OVĚŘENO živým dotazem 19. 11. 2026):**
- Dotaz `POST /ekonomicke-subjekty/vyhledat` přijme nejvýše 100 IČO. 101 IČO vrátí chybu.
- Odpověď obsahuje název, kód právní formy, datum vzniku a zániku, CZ-NACE (klasifikace 2025 a zvlášť 2008), kraj a okres sídla.
- Okres u pražských subjektů chybí. Datum vzniku u některých subjektů chybí.
- Podmínky provozu ARES uvádějí jako zneužití více než 500 dotazů za minutu. Denní limit zveřejněný není. Hromadné posílání neplatných IČO je uvedeno jako zneužití.

**Návrh:**
- Před dotazem se každé IČO zkontroluje lokálně (délka, kontrolní součet). Neplatná IČO se do ARES neposílají.
- Fronta `ares_lookup` po 100 IČO, výchozí tempo 10 dotazů za minutu = 1 000 IČO za minutu. Celá databáze: 900 dávkových dotazů, asi 90 minut. To je 2 % hranice uvedené v podmínkách. K tomu jednotlivé dotazy pro IČO, která v dávkové odpovědi chybí (viz níže): tempo `ares.single_requests_per_minute` (60 za minutu, 12 % hranice), takže 5 000 chybějících IČO je asi 85 minut navíc, 10 000 necelé 3 hodiny. Kolik jich v letitém Excelu bude, nevím.
- Cache: IČO ověřené před méně než `ares.cache_days` dny se znovu nevolá. Surová odpověď ARES se neukládá (šetří místo), ukládají se jen potřebná pole.
- Typ FO/PO se odvodí z kódu právní formy podle `ares.fo_legal_forms`. Kód se ukládá, takže změna pravidla nevyžaduje nový dotaz.
- IČO, které v odpovědi chybí, se ověří jednotlivým dotazem (ten rozliší „nenalezeno“). Dávkový dotaz neexistující IČO tiše vynechá, bez chyby (podle živého pokusu recenze 19. 11. 2026: 8 IČO, z toho 3 neexistující, odpověď vrátila 5). Jak dávkový dotaz vrací zaniklé subjekty, je NEOVĚŘENO a otestuje se jako první věc kroku 3 na známém zaniklém IČO.
- Chyba 429 = zpomalit a pokračovat později. Chyba 5xx = opakovat. Obojí se rozlišuje (portál to slučoval).
- Praha: okres se doplní hodnotou „Praha“.

### 5.3 CheckMobi

**Fakta (OVĚŘENO z dokumentace a ceníku):**
- Jednotlivý dotaz `GET /v1/lookup/mnp/{číslo}` vrací aktuální síť (kód MCC/MNC, název) a cenu dotazu.
- Hromadný dotaz (až 1 000 čísel) je asynchronní a vyžaduje veřejnou adresu pro zaslání výsledků.
- Cena pro Česko: MNP 0,002 USD, HLR 0,004 USD za dotaz.
- Zdarma je kontrola formátu čísla (`/lookup/verify`), která vyřadí neplatná čísla a pevné linky.

**NEOVĚŘENO:** zda MNP u českých čísel opravdu vrací aktuálního operátora u přenesených čísel (ceník má u Česka sloupec přenositelnosti prázdný), zda je nutné měsíční předplatné, kde CheckMobi data zpracovává (požadavek EU).

**Návrh:**
- Použít jednotlivé dotazy z fronty `checkmobi_lookup` s tempem z nastavení. Nevzniká tím žádná veřejná adresa, která by přijímala telefonní čísla.
- Volají se jen čísla bez ověření nebo s ověřením starším než `checkmobi.max_age_days` (180).
- Žádné číslo se neplatí dvakrát: do náhledu nové dávky se neberou čísla, která jsou v jiné neuzavřené dávce. Před každým voláním úloha znovu zkontroluje `operator_verified_at` proti `checkmobi.max_age_days` (ne jen při sestavení náhledu) a založí řádek `checkmobi_lookups` ve stavu `pending` (UQ `phone_id`, `batch_id`). Úloha vrácená do fronty po propadlém zámku čísla s řádkem `pending` nebo `done` z téže dávky přeskočí. Řádek, který zůstal `pending` (odpověď se ztratila po zaplaceném volání), se ukáže k ruční kontrole a sám se znovu nevolá.
- Podmínka před prvním skutečným číslem, včetně testovacích 10–20 čísel: potvrzené místo zpracování u CheckMobi a uzavřená smlouva o zpracování osobních údajů (podklad ke kroku 3, oddíl 9).
- Před dávkou obrazovka ukáže: počet čísel, kolik se přeskočí díky cache, počet placených volání, odhad ceny (počet × `checkmobi.price_per_lookup`). Bez potvrzení se nic nezavolá. Kdo a kdy potvrdil, je v `job_batches` a v audit logu.
- Skutečná cena z odpovědi se ukládá do `checkmobi_lookups`, takže jde porovnat odhad se skutečností.
- Převod kódu sítě na VF / O2 / TM je v `checkmobi.operator_map`. Virtuální operátoři spadnou do „jiný“.
- Před první velkou dávkou test na 10–20 číslech, u kterých Thomas zná skutečného operátora včetně přenesených. Když MNP neobstojí, záloha je HLR za dvojnásobnou cenu.
- Odhad nákladů: 90 000 čísel × 0,002 USD = 180 USD, 10 000 čísel = 20 USD.

### 5.4 Siebel (souborové rozhraní, nahraditelné přímým API)

Zbytek aplikace nezná Excel ani Citrix. Zná jen „bránu“ se třemi operacemi:

| Operace | Co dělá dnes (soubory) | Co by dělala s API |
|---|---|---|
| `requestOwnerCheck(seznam IČO)` | založí `siebel_runs`, vygeneruje vstupní Excel pro skill `siebel-vlastnik`, založí úkol | zavolá API a rovnou uloží výsledek |
| `requestOverblocking(položky)` | založí `siebel_runs`, vygeneruje vstupní Excel pro skill `siebel-preblokace`, založí úkol | podá přeblokace přes API |
| `applyResults(běh, výsledky)` | zpracuje naimportovaný výstupní Excel | zpracuje odpověď API |

- Výsledek se vždy zapíše do stejných tabulek (`siebel_run_items`, pak `companies`: vlastník, platnost příležitosti, stav). Moduly, které výsledek potřebují (plováky, dávky), se dívají jen do nich.
- Formát vstupního a výstupního Excelu je v `file_templates`, ne v kódu. Změna sloupce ve skillu = změna v nastavení.
- Import výstupu: náhled změn (kolik IČO změní vlastníka, kolik stav) → potvrzení → zápis → úkol se uzavře.
- Výměna za API později znamená napsat druhou bránu se stejnými třemi operacemi. Obrazovky, úkoly a pravidla zůstanou.

Stejný princip (šablony v `file_templates`, náhled, potvrzení) platí pro soubory robota.

### 5.5 Excel

- Soubory čte a vytváří prohlížeč. Serverová funkce má na jeden požadavek jen 2 sekundy procesorového času, 90 tisíc řádků by nezvládla.
- Import: prohlížeč soubor načte, uživatel namapuje sloupce, řádky se zkontrolují a po dávkách (asi 1 000 řádků) pošlou na server do `import_rows`. Server zkontroluje znovu (prohlížeči nevěří), ukáže souhrn a po potvrzení zapíše.
- Zápis po potvrzení: 90 tisíc řádků do `companies` (asi 14 indexů včetně trigramu a GIN), `company_phones` a 90 tisíc řádků historie se nevejde do 2 s procesoru funkce ani do 8s limitu jednoho dotazu (oddíl 7). Proto ho dělá úloha `import_apply` z fronty: databázová funkce zapíše vždy jeden úsek řádků (např. 5 000 podle `row_no`) v jedné transakci a posune `imports.applied_through_row`. Import je po tu dobu ve stavu `applying`, průběh je vidět na obrazovce a přerušený zápis naváže tam, kde skončil.
- Export: prohlížeč si vyžádá exportní token metodou, která nejdřív zapíše do audit logu kdo, jaký filtr a kolik řádků exportuje. Data se pak vydávají po stránkách jen proti tomuto jednorázovému tokenu. Běžný seznam má strop stránky `list.max_page_size` a užší výčet polí, přímé čtení tabulek z prohlížeče není možné vůbec (oddíl 4, Společná pravidla). Přihlášený uživatel si seznam po stránkách prohlédnout může, to audit exportu nezachytí a ani nemá.
- Knihovna pro xlsx v projektu zatím není. Výběr a schválení proběhne na začátku kroku 2 (pravidlo ze zadání: instalace knihovny = samostatný souhlas).

---

## 6. Bezpečnost a osobní údaje

| Požadavek ze zadání | Konkrétní opatření |
|---|---|
| Server a databáze v EU | Projekt Supabase v regionu Frankfurt (databáze, přihlášení). Serverová funkce: Edge Functions se podle všeho samy nedrží regionu projektu a požadavek běžně obslouží region nejbližší volajícímu (NEOVĚŘENO proti aktuální dokumentaci). Před krokem 2 se proto ověří, jak se volání připoutá k regionu EU (hlavička regionu nebo nastavení funkce), a připoutají se všechna volání `api` z prohlížeče i z plánovače (pg_net). Kontrola: funkce vrací region, ve kterém běžela, a test ověří, že je v EU. Cloudflare Pages vydává jen samotnou aplikaci bez dat. Data k vnějším službám: ARES (stát, ČR, jen IČO), Raynet (stávající CRM), CheckMobi (telefonní čísla; místo zpracování a smlouvu o zpracování je nutné ověřit před první dávkou). |
| Přihlášení jen pro whitelist s 2FA | Účet vzniká jen skriptem z příkazové řádky, registrace je v Supabase vypnutá. Whitelist = řádky v `users` (dva). 2FA přes aplikaci Authenticator (TOTP) je povinné pro oba. Pravidlo zní „tato relace prošla 2FA“ (`aal2` v tokenu relace) a aktivní řádek v `users`, ne „účet má faktor“: relace jen s heslem (`aal1`) nedostane nic, ani když má účet faktor zapsaný, takže ukradené heslo nestačí. Kontroluje se na serveru před každou metodou. Databáze sama přihlášenému nevydá nic (RLS bez politik), takže druhá cesta k datům neexistuje. Aplikace vypnutí 2FA nenabízí. Rozhraní přihlášení Supabase ale dovolí relaci `aal2` faktor odebrat i bez naší obrazovky; uživatel pak nevidí nic, dokud si 2FA nenastaví znovu, a odebrání se zapíše do audit logu při dalším přihlášení. Testy: relace `aal1` uživatele s faktorem nedostane nic z `api` ani z žádné tabulky; test izolace to ověřuje pro všechny tabulky. |
| Šifrované zálohy denně | Závisí na otevřeném rozhodnutí o tarifu (oddíl 8.1). Varianta Pro: denní zálohy od Supabase, držené 7 dní. Varianta zdarma: vlastní noční záloha (výpis databáze, zašifrování veřejným klíčem, uložení mimo Supabase). V obou variantách doporučuji jednou za čtvrt roku zkusit obnovu. Dokumentace Supabase výslovně neuvádí, že jsou zálohy Pro šifrované (NEOVĚŘENO). Dnes tedy požadavek „šifrované zálohy denně“ nesplňuje s jistotou ani jedna varianta: u Pro je třeba šifrování potvrdit u Supabase, jinak přidat vlastní šifrovaný výpis i k tarifu Pro. Vlastní záloha (ať už jako jediná, nebo doplňková) nemůže běžet v serverové funkci (2 s procesoru) a musí mít před stavbou určeno: kde výpis běží (stroj v EU; běžný hostovaný runner GitHubu by nešifrovaný výpis osobních údajů zpracoval mimo EU), kam se šifrovaný soubor ukládá (úložiště v EU mimo Supabase), kdo drží soukromý klíč (mimo GitHub i Supabase, offline), jak dlouho se zálohy drží, a jak se pozná neúspěch (varování na dashboardu, když je poslední záloha starší než `backup.max_age_hours`). Tyto body rozhodne Thomas spolu s tarifem (8.1 č. 1). Zkouška obnovy patří do kritérií kroku 2. |
| Audit log kdo co změnil nebo exportoval | Tabulka `audit_log`, do které se jen přidává. Zapisuje se: každá změna stavu ručně; každé přepsání data nebo barvy; změna nastavení; každý zápis do tabulek pravidel (`state_transitions`, `loss_rules`, `release_rules`, `file_templates`, `sales_reps`) se starým a novým řádkem; potvrzení placené dávky; potvrzení zápisu do Raynetu; import; každý export (kdo, filtr, počet řádků, exportní token); každé vygenerování a každé stažení souboru pro robota nebo Siebel (kdo, dávka nebo běh, počet řádků), protože jsou to seznamy IČO s čísly CA, které opouštějí aplikaci; rozhodnutí oranžových v aplikaci; potvrzení přidělení; úspěšné i neúspěšné přihlášení a zablokování účtu. Řádek auditu vzniká ve stejné transakci jako změna. Export bez zápisu do logu není možný: přímé čtení tabulek z prohlížeče neexistuje (RLS bez politik) a data exportu vydává až metoda, která log zapsala. Test: přímý dotaz na REST rozhraní s platným tokenem `aal2` nevrátí ani řádek. |
| API klíče jen v proměnných prostředí | Klíče Raynetu a CheckMobi jsou jen v tajemstvích serverové funkce (`RAYNET_API_KEY`, `RAYNET_USER`, `RAYNET_INSTANCE`, `CHECKMOBI_API_KEY`). Nejsou v repozitáři, v databázi ani v zálohách. Prohlížeč je nikdy nedostane. Na rozdíl od portálu se klíč Raynetu nenastavuje z obrazovky. |
| `noindex`, žádná veřejná stránka | Hlavička `X-Robots-Tag: noindex, nofollow`, `robots.txt` se zákazem všeho, značka v kostře stránky. Jediná stránka dostupná bez přihlášení je přihlašovací formulář. Server nemá žádnou veřejnou metodu. |

Další opatření nad rámec zadání:
- Prohlížeč nemá právo zápisu ani přímého čtení žádné tabulky. Vše jde přes seznam povolených metod.
- Log volání vnějších služeb neobsahuje těla požadavků ani telefonní čísla: ukládá se šablona cesty, ne skutečná cesta, a text chyby se čistí (oddíl 4.1).
- Ze zrcadla Raynetu se neukládají texty aktivit a poznámky.
- Doby držení osobních údajů jsou v nastavení: chybové řádky importu (`retention.import_error_rows_days`), OP, aktivity a nabídky IČO, které vypadlo ze hry (`retention.raynet_mirror_days_after_play`), snímky vstupů semaforu, log volání. Úklid dělají denní pravidla.
- Nenamapované sloupce Excelu se ukládají jen po výslovném zaškrtnutí při mapování.
- Žádost FO o výmaz nebo námitka (NÁVRH, otázka 8.2 č. 26): smažou se telefony, název a `extra`, v Raynetu se nic nemění. IČO zůstane s příznakem `never_return`, aby se do dávek nevrátilo. V historii a audit logu, které upravit nejde, zůstává jen IČO.
- Hlavičky zabezpečení z portálu (HSTS, zákaz vložení do rámce, CSP jen na vlastní projekt).
- Kód aplikace pro prohlížeč je veřejně stažitelný (tak fungují všechny webové aplikace). Proto v něm není žádné tajemství a pravidla se vynucují na serveru.
- Ztráta telefonu s Authenticatorem: doplníme skript pro odebrání 2FA faktoru, který může spustit jen vlastník projektu Supabase. Účet vlastníka projektu Supabase musí mít sám 2FA.
- Heslo: navrhuji delší minimum než v portálu (12 znaků) a kontrolu uniklých hesel, pokud ji zvolený tarif umožní (NEOVĚŘENO).

---

## 7. Limity platformy a jak je obcházíme

| Limit | Dopad | Řešení |
|---|---|---|
| Serverová funkce: 2 s procesorového času na požadavek, 150 s běhu (zdarma) / 400 s (placený tarif), 256 MB paměti (OVĚŘENO) | Import, ARES, CheckMobi ani synchronizace Raynetu se nevejdou do jednoho požadavku | Fronta `jobs`. Plánovač každou minutu odbaví malý kousek (asi 50 sekund práce) a skončí. Každý kousek jde spustit znovu. Násilně ukončený běh nechá úlohu `running`; do fronty ji vrátí propadnutí zámku po `jobs.lock_timeout_minutes` (oddíl 4.1). |
| Délka jednoho dotazu do databáze (podle dokumentace Supabase): role `anon` 3 s, `authenticated` 8 s, `service_role` nemá vlastní limit a dědí 8 s od role `authenticator` | Zápis 90 tisíc řádků importu, přechod stavu pro celou dávku 4 000 IČO s historií, import výsledku robota ani noční pravidla nad celou databází nejdou jedním příkazem přes rozhraní databáze | Hromadné zápisy jako databázové funkce volané přes RPC s vlastním `set statement_timeout` (dokumentace to pro funkce podporuje), nebo po úsecích přes frontu (`import_apply` po asi 5 000 řádcích). Čtení seznamu se měří `explain analyze` nad 90 tisíci řádky (kritérium kroku 2). |
| Velikost těla požadavku na funkci: v dokumentaci neuvedena (NEOVĚŘENO) | Nelze nahrát celý Excel najednou | Excel se čte v prohlížeči a posílá po dávkách asi 1 000 řádků. |
| Databáze vrací nejvýše 1 000 řádků na dotaz | Seznam 90 tisíc IČO nejde stáhnout celý | Stránkování, řazení a filtrování na serveru, indexy na filtrovaných sloupcích. |
| pg_cron: doporučeno nejvýše 8 souběžných úloh, každá do 10 minut; pg_net nečeká na výsledek a chybu neohlásí | Tichý výpadek plánovače by ohrozil termíny dávek | Jedna minutová úloha + jedna denní. Každý běh zapíše čas do databáze. Dashboard ukáže varování, když fronta neběžela déle než 10 minut nebo denní pravidla neproběhla. |
| Raynet: 24 000 volání denně na instanci, 4 souběžná spojení na klienta | Denní limit sdílen s tipařským portálem. Portál sám posílá 5 souběžných požadavků v 0:00 a 15:00 | Vlastní strop 12 000, rezerva podle hlavičky, 2 souběžná spojení hlídaná poradním zámkem přes všechny běhy, vlastní API uživatel (oddělení souběžnosti ověřit v kroku 5), čtení po stránkách místo po IČO (oddíl 5.1). |
| Raynet: hledání podle IČO jen po jednom, zápis polí jen po jedné firmě | 12 000 hledání = polovina limitu | Vlastní seznam firem (ID ↔ IČO), zápis frontou. |
| ARES: 100 IČO na dotaz, bez zveřejněného denního limitu; dávka chybějící IČO tiše vynechá | Blokace by mohla zasáhnout i tipařský portál, pokud sdílí odchozí adresu. Chybějící IČO stojí každé jedno volání navíc | Tempo 10 dávkových a 60 jednotlivých dotazů za minutu (obojí v nastavení), lokální kontrola IČO předem, cache. |
| CheckMobi: hromadný dotaz chce veřejnou adresu | Veřejná adresa přijímající telefonní čísla je riziko | Jednotlivé dotazy z fronty. |
| Supabase zdarma: 500 MB databáze, pozastavení po 7 dnech nečinnosti, žádné zálohy, nejvýše 2 projekty (oba obsazené) | Projekt nejde na tarifu zdarma ani založit | Otevřené rozhodnutí 8.1. |
| Velikost dat (hrubý odhad, NEOVĚŘENO): 90 tisíc IČO s telefony a indexy 150–200 MB; historie a zrcadlo Raynetu desítky MB ročně; `semaphore_evaluations` asi 6–8 tisíc řádků měsíčně se snímkem vstupů, tedy spíš kolem sta MB ročně; záznamy minutové úlohy plánovače v `cron.job_run_details` (1 440 řádků denně, asi 525 tisíc ročně, tabulka se sama nečistí a portál ji také nečistí) desítky až přes sto MB ročně; dočasně `import_rows` pro 90 tisíc řádků (místo se po smazání nevrátí systému bez `vacuum full`); log volání podle doby držení | Na 500 MB by bylo těsno už během prvního roku. Další argument pro variantu Pro v rozhodnutí 8.1 č. 1, které tím ale rozhodnuté není | Surové odpovědi ARES se neukládají, log volání se maže po `logs.api_call_retention_days`, řádky importu se po použití mažou. Denní úklid `cron.job_run_details` starších než `logs.cron_run_retention_days`. Snímek vstupů semaforu obsahuje jen hodnoty, které vstoupily do pravidel, a maže se po `semaphore.inputs_retention_days`. |
| E-maily ze Supabase: 2 za hodinu bez vlastního SMTP | Pozvánky a obnova hesla e-mailem by nefungovaly spolehlivě | Účty i obnova hesla jen skriptem, bez e-mailu. |
| Nastavení přihlášení v Supabase není v kódu portálu | Po obnově projektu by mohla být registrace zapnutá a 2FA vypnuté | Kontrolní seznam v dokumentaci kroku 2: registrace vypnuta, TOTP zapnuto, adresy přesměrování. Test, že registrace bez pozvání selže. |
| Složka na ploše je v iCloudu | iCloud odkládá soubory, git a build se zasekávají, vznikají kopie „… 2“ | Otevřené rozhodnutí 8.1. |
| Brand manuál A4M nemá zelenou ani červenou | Semafor je ze zadání barevný | Navrhuji tři barvy semaforu jako vědomou výjimku, vždy s textem vedle barvy. Potvrdí Thomas v kroku 6. |

---

## 8. Otevřená rozhodnutí

### 8.1 Rozhodnutí, která čekají na Thomase

| Č. | Rozhodnutí | Možnosti | Co z toho plyne |
|---|---|---|---|
| 1 | **Tarif Supabase** — ROZHODNUTO 19. 11. 2026: **zdarma + vlastní šifrované zálohy**. Místo pro projekt je volné (OVĚŘENO 19. 11. 2026 výpisem projektů: aktivní je jen ostrý portál, testovací `mkwtbx…` je už pozastavený; pozastavené projekty se do limitu 2 nepočítají a jdou obnovit 1 rok, zdroj: dokumentace Supabase). Podoba záloh SCHVÁLENA 19. 11. 2026: každou noc přes GitHub Actions, výpis databáze zašifrovaný před odesláním (dešifrovací klíč drží jen Thomas, mimo GitHub i úložiště, na dvou místech), uložení v Cloudflare R2 s umístěním v EU, držení 30 dní (v nastavení), při selhání úkol v aplikaci, občasná zkouška obnovy. | a) Pro, asi 25 USD měsíčně: denní zálohy držené 7 dní, bez pozastavování, 8 GB místa. b) Zdarma + vlastní šifrované zálohy. | Varianta b) dnes naráží na limit 2 projektů zdarma, oba jsou obsazené (portál ostrý a testovací). Bez uvolnění jednoho z nich nebo jiné organizace nejde projekt založit. Varianta b) také znamená postavit a hlídat vlastní zálohy a riziko pozastavení při nečinnosti. Bez tohoto rozhodnutí nezačne krok 2. K variantě a): tarif Pro se platí za organizaci a každý projekt v ní má vlastní výpočetní výkon (v ceně je kredit zhruba na jeden nejmenší projekt). Částka asi 25 USD platí, když projekt vznikne v nové, vlastní organizaci a projekty portálu zůstanou v původní organizaci zdarma. Převod stávající organizace na Pro by znamenal platit tři projekty, odhadem o 20 USD měsíčně víc (z paměti, NEOVĚŘENO, před založením ověřit v ceníku Supabase). K oběma variantám patří rozhodnout body k zálohám z oddílu 6: šifrování záloh Pro potvrdit u Supabase, nebo přidat vlastní šifrovaný výpis; u vlastního výpisu kde běží, kam se ukládá a kdo drží klíč. |
| 2 | **Viditelnost repozitáře** — ROZHODNUTO 19. 11. 2026: **zůstává veřejný**. Proto do něj nikdy nesmí ostrá data, vzory souborů Vodafonu s reálnými údaji, klíče ani zálohy; ukázky jen se smyšlenými daty. | Dnes je repozitář veřejný. Doporučení: soukromý. | Repozitář bude obsahovat strukturu databáze, obchodní pravidla a později vzory souborů Vodafonu. Osobní údaje ani klíče v něm nebudou nikdy. |
| 3 | **Pracovní složka mimo iCloud** | a) Klon mimo iCloud (např. `~/Projekty/…`). b) Vypnout „Optimalizovat úložiště“. c) Pracovat v cloudové relaci. | V portálu už iCloud způsobil zaseknutý git a zdvojené složky. Nový repozitář je teď na stejné ploše. |

### 8.2 Otázky k zadání, bez kterých nejde daný krok dokončit

| Č. | Otázka | Potřeba pro krok |
|---|---|---|
| 1 | Tabulka přechodů stavů (oddíl 4.3): řádky označené „výklad“ jsou můj návrh. Souhlasí? | 2 |
| 2 | Od kterého data se počítá den 0 dávky: potvrzené nahrání do robota, nebo přistání na superuseru podle výsledku? | 4 |
| 3 | Co znamená „malé firmy“ v pravidle rozdělení na kanály? ARES velikost firmy v základní odpovědi nevrací. | 4 |
| 4 | Kdo a kdy zakládá firmy z dávky do Raynetu? Aplikace firmy zakládat nesmí, ale pole Kohorta jde zapsat jen existující firmě. | 5–6 |
| 5 | Jak se v Raynetu pozná: úspěšný kontakt, potvrzený zájem, nezájem, „nezajímavý“, odklad s důvodem a datem, „nikdy nezvedl“, celá kadence, závazek u konkurence, lead pořád otevřený a nezpracovaný? (kategorie aktivity, výsledek, vlastní pole?) A kde je v Raynetu „výsledek“ aktivity, který zadání žádá číst? | 5–6 |
| 6 | Kde je v Raynetu „potenciál v BMSL“: hodnota OP, hodnota nabídky, nebo vlastní pole? | 6 |
| 7 | IČO s potenciálem 500–799 BMSL bez dalších signálů zadání nezařazuje. Návrh: oranžová. | 6 |
| 8 | Checkpoint 1 používá stejná červená pravidla jako checkpoint 2? | 6 |
| 9 | Rotace zmiňuje důvod „nezájem“, ten v tabulce důvodů prohry není. Které ID to je? | 9 |
| 10 | Délka karantény u důvodů 121 a 294 (návrh 12 měsíců, shodně s návratem). Důvod 206 „nikdy“: návrh je trvalé vyřazení (příznak `never_return`, IČO se samo nikdy nevrátí, zrušit jde jen ručně). Souhlasí? Důvod 243: má mít IČO 6 měsíců karanténu, nebo jen datum návratu? | 7 |
| 11 | Co znamená „dovoláno“ v měření? | 10 |
| 12 | Smí aplikace po uzavření dávky vyprázdnit pole Rozhodnutí o vlastnictví, aby staré rozhodnutí neplatilo pro příští kolo? | 6 |
| 13 | Souhlas s jednorázovým čtením ostré instance Raynetu (limit, vlastní pole, číselníky) přes existující konektor před krokem 5. | 5 |
| 14 | Semafor zelená / oranžová / červená jako výjimka z brand manuálu. | 6 |
| 15 | Důvod 243 „znovu přes robota za 6 m“ s akcí Odvlastnit: návrh je vést IČO jako plovák jen s cestou robota, bez kontroly vlastníka v Siebelu a bez přeblokace. Souhlasí, nebo má IČO zůstat v poolu s datem „ne dřív než“? | 7 |
| 16 | Důvod 293 „Držet (PO longterm)“: platí držení jen pro PO? Co s FO, které má konec závazku dál než 3 měsíce (návrh: plovák s datem návratu konec závazku − 3 m)? Stejně u 122 nad 1 500 BMSL na FO a u 123 na FO. | 7 |
| 17 | Měsíční revize loginů OZ: po kolika dnech je převzaté oranžové IČO „bez posunu“ (návrh 30) a kdy je aktivita „propadlá“ (návrh: hned po termínu)? | 6 |
| 18 | Červená „vrátit nebo odvlastnit“: pro každý důvod červené (nezájem, nezajímavý, nekontaktní a nikdy nezvedl, neaktivní IČO, potenciál pod 500 BMSL, bez rozhodnutí do termínu, spadlo při měsíční revizi) určit, jestli se IČO vrací se statusy, nebo odvlastňuje, do kterého poolu, s jakým návratovým statusem, za jak dlouho se vrací a jestli má karanténu (tabulka `release_rules`). | 6 |
| 19 | Jak se v Siebelu fyzicky provede převod IČO ze superusera na login OZ (zelená, „Držet“) a jak uvolnění IČO z loginu OZ (odvlastnit, plovák, odvlastnit + karanténa)? Robot má jen 4 režimy. Dělá to robot souborem, Thomas ručně, OZ sám, nebo přeblokace? Podle toho vznikne soubor a úkol. | 6–7 |
| 20 | Kde se eviduje, že operátorka předala lead obchodníkovi (lead v Raynetu, aktivita, vlastní pole, nic)? Operátorky do aplikace nechodí, takže rovnoměrné rozdělení 7–10 leadů denně nemá bez toho z čeho počítat. | 9 |
| 21 | Konec vlastnictví na loginu OZ: je to pevná doba (jiná pro FO a PO), nebo platnost příležitosti v Siebelu, kterou OZ prodlužuje? Datum se zapisuje do Raynetu. | 6 |
| 22 | Firma s více telefony: stačí k vyřazení z dávky jedno číslo u Vodafonu (návrh), nebo rozhoduje hlavní číslo, nebo musí být u Vodafonu všechna? | 3 |
| 23 | Odchylka od zadání: aplikace si stáhne seznam všech firem Raynetu, ale u firem mimo hru uloží jen ID a IČO. Důvod je cena volání. Souhlas? | 5 |
| 24 | „David“: mají se z měření vyřadit jen jeho OP, nebo i jeho aktivity („dovoláno“) a nabídky? | 10 |
| 25 | Vyčerpaná rotace s výsledkem „karanténa“: na jak dlouho (návrh 12 měsíců)? | 9 |
| 26 | Osobní údaje FO: souhlas s postupem při žádosti o výmaz (smazat telefony a název, IČO ponechat s trvalým vyřazením) a s dobami držení v nastavení `retention.*`. Které nenamapované sloupce kmenového Excelu se mají vůbec ukládat? | 2 |

---

## 9. Podklady od Thomase po krocích

| Krok | Podklad | Poznámka |
|---|---|---|
| 2 | Rozhodnutí 8.1 č. 1–3 | bez tarifu nejde založit projekt |
| 2 | Ukázka kmenového Excelu (struktura sloupců, stačí 50–100 řádků, klidně s pozměněnými údaji) | hlavně: jak jsou zapsané telefony, jestli je tam dnešní stav a držitel |
| 2 | E-maily obou uživatelů | pro založení účtů |
| 2 | Rozhodnutí k zálohám (součást 8.1 č. 1): kde běží vlastní výpis, kam se ukládá, kdo drží soukromý klíč | jen pokud bude vlastní záloha potřeba |
| 2 | Odpověď na otázku 8.2 č. 26 | co z Excelu ukládat, doby držení |
| 2 | Jednorázové přihlášení na Macu při zprovoznění (GitHub, Supabase, Cloudflare) | tokeny nejdou vytvořit z gitu |
| 3 | API klíč CheckMobi (vloží se přímo do tajemství, ne do chatu ani do repozitáře) a potvrzená cena za dotaz | |
| 3 | 10–20 telefonních čísel se známým operátorem, z toho několik přenesených | test spolehlivosti MNP |
| 3 | Seznam cílových oborů (CZ-NACE), pokud se má filtrovat už teď | |
| 3 | Potvrzení od CheckMobi, kde data zpracovává, a uzavřená smlouva o zpracování osobních údajů | podmínka před odesláním prvního skutečného čísla, i testovacího |
| 3 | Odpověď na otázku 8.2 č. 22 | |
| 4 | Vzory Excelu pro robota ve všech 4 režimech | očištění, prodloužení, vrácení statusů, odvlastnění |
| 4 | Seznam návratových statusů robota | |
| 4 | Ukázka výsledku od robota (přistálo / nepřistálo a důvody) | |
| 4 | Odpovědi na otázky 8.2 č. 2 a 3 | |
| 5 | Přístup k Raynet API (uživatel, klíč, název instance) do tajemství | rozhodnout, zda sdílet s portálem; doporučuji vlastního API uživatele kvůli limitu souběžnosti (oddíl 5.1) |
| 5 | Názvy a ID vlastních polí: Kohorta, Semafor, Rozhodnutí o vlastnictví, Konec vlastnictví, Konec závazku, operátor | |
| 5 | Seznam OZ: jméno, Siebel login, Raynet ID, typ (jezdí / online), domovský kraj | |
| 5 | Odpovědi na otázky 8.2 č. 4, 13 a 23 | |
| 6 | Odpovědi na otázky 8.2 č. 5–8, 12, 14, 17–19, 21 | mapování signálů semaforu, pravidla pro červenou, převod na login OZ |
| 6 | Jedna zkušební firma v Raynetu pro ověření zápisu vlastních polí | před prvním zápisem |
| 6 | Jedna reálná dávka pro ostrý test | |
| 7 | Potvrzení tabulky důvodů prohry a otázky 8.2 č. 10, 15, 16 | |
| 8 | Formát vstupu a výstupu skillů `siebel-vlastnik` a `siebel-preblokace` (ukázkové soubory) | |
| 9 | Odpovědi na otázky 8.2 č. 9, 20, 25, potvrzení regionálních pravidel | |
| 10 | Odpovědi na otázky 8.2 č. 11 a 24 | |

Přístup k repozitáři tipařského portálu už je, průzkum proběhl.

---

## 10. Pořadí stavby

Každý krok začíná krátkým plánem a čeká na souhlas. Každý krok má vlastní větev.

| Krok | Obsah | Hotovo znamená |
|---|---|---|
| 1. Průzkum a návrh | Tento dokument. | Thomas návrh schválil, rozhodl body 8.1 a potvrdil nebo opravil tabulku přechodů stavů. |
| 2. Master databáze, import, historie | Založení projektu, přihlášení s 2FA, nastavení, audit log, tabulka IČO se stránkováním a filtry, import Excelu s mapováním, historie stavů, export. | Oba uživatelé se přihlásí s 2FA, nikdo jiný ne. Ostrý Excel (~90 tisíc řádků) je naimportovaný, report ukáže neplatná IČO a duplicity, počty sedí s Excelem. Hledání a filtr odpoví do 2 sekund, změřeno `explain analyze` nad 90 tisíci řádky stejnou cestou, jakou čte `api`. Export je v audit logu. Ruční změna stavu mimo povolené přechody je odmítnuta. Test izolace projde: přímý dotaz s tokenem `aal2` i `aal1` nevrátí z žádné tabulky nic, relace `aal1` nedostane nic ani z `api`, historii a audit nejde upravit ani smazat ani servisní rolí. Souběžný test: dva současné přechody téhož IČO ze stejného stavu, projde jen jeden a historie má jeden řádek. Přerušený zápis importu jde dokončit. IČO bez úvodních nul z Excelu se doplní, ne vyřadí. Funkce `api` běží v regionu EU (ověřeno testem). Záloha existuje, je šifrovaná a obnova byla jednou vyzkoušena. |
| 3. Předfiltr ARES + CheckMobi | Fronta úloh, dávkový ARES, CheckMobi s náhledem ceny, filtry dávky. | ARES doplnil typ, kraj, okres, obor, rok založení a platnost u celé databáze, průběh je vidět na obrazovce. Test CheckMobi na známých číslech vyhodnocen. Placená dávka se bez potvrzení nespustí, odhad ceny odpovídá skutečnosti z odpovědí. Opakované spuštění nevolá čísla ověřená před méně než 180 dny. Před prvním skutečným číslem je potvrzené místo zpracování u CheckMobi a uzavřená smlouva o zpracování. Chování dávky ARES u zaniklého IČO ověřeno jako první věc kroku. Násilně ukončená úloha se po propadnutí zámku dokončí a žádné číslo se nezaplatí dvakrát. V logu volání ani v chybách úloh není žádné telefonní číslo. |
| 4. Dávky a robot | Sestavení dávky, rozdělení na kanály, generátor 4 souborů ze šablon, import výsledku, časová osa, úkoly kolem robota. | Vygenerovaný soubor každého režimu robot přijme bez ruční úpravy. Import výsledku přesune přistálá IČO na superusera a nepřevzatá vrátí do poolu s důvodem. Úkoly vznikají a zavírají se samy, tlačítko „Hotovo – nahráno dne“ posune časovou osu. **Ostrý test na jedné dávce souběžně s ručním postupem, rozdíly vysvětleny.** |
| 5. Synchronizace z Raynetu (čtení) | Seznam firem, OP, aktivity, nabídky, číselníky, log volání, hlídání limitu. | Fakta z ostré instance ověřena (limit, pole, ID číselníků). U 20 náhodných IČO ve hře sedí data v aplikaci s Raynetem. Denní spotřeba volání je vidět a drží se pod stropem. Výpadek Raynetu synchronizaci nerozbije, po obnovení doběhne. OP loginu „David“ jsou označené. Ověřeno: operátor `IN` ve filtrech, co je „klient“ u limitu souběžnosti, kde je výsledek aktivity. IČO s nedočtenou historií je tak označené a kontrola 20 IČO se dělá až po dočtení. |
| 6. Semafor, checkpointy, oranžová fronta, zápis do Raynetu | Výpočet barev, odůvodnění, ruční přepsání, kdo rozhoduje, čtení rozhodnutí OZ, zápis 4 polí s náhledem. | Každé IČO dávky má barvu a čitelné odůvodnění. Změna prahu v nastavení změní výsledek bez zásahu do kódu. Rozhodnutí „Držet“ bez naplánované aktivity není uznáno. Bez rozhodnutí do termínu platí „pustit“. Zápis do Raynetu ukáže náhled, po potvrzení zapíše jen čtyři pole a nic jiného. Před prvním zápisem je na zkušební firmě ověřeno, že zápis ostatní vlastní pole nesmaže. Hodnota změněná v Raynetu po náhledu se nepřepíše (řádek `skipped`). Dvojí potvrzení nezařadí zápisy dvakrát. Při starých datech z Raynetu se checkpoint ani výchozí „pustit“ neprovede a vznikne úkol. **Ostrý test na jedné dávce, barvy porovnány s ručním hodnocením.** |
| 7. Důvody prohry, plovák, karanténa | Tabulka pravidel, výpočet akce a data návratu, úkol na chybějící konec závazku, automatický konec karantény. | Pro každý řádek tabulky ze zadání existuje test se správnou akcí a datem. Prohraná OP se zpracuje právě jednou. Plovák se 3 měsíce před návratem objeví ve frontě ke kontrole. IČO v karanténě ani IČO s trvalým vyřazením (206) se nedostane do dávky. Ruční přepsání data vyžaduje poznámku a pozdější automatický výpočet přepsané datum nezmění. |
| 8. Siebel | Generátor vstupů pro oba skilly, import výstupů, úkoly, brána. | Skill `siebel-vlastnik` i `siebel-preblokace` přijme vygenerovaný vstup bez úprav. Import výstupu aktualizuje vlastníka, platnost příležitosti a stav a uzavře úkol. Plovák projde celou cestu: kontrola → přeblokace nebo robot. |
| 9. Přidělování, rotace, region, limity | Přidělení pro cold call, rozdělení leadů operátorky, regionální pravidlo, rotace, hlídání limitů. | Jezdící OZ dostane jen IČO ze svého kraje. Při návratu IČO nedostane poslední OZ. Po důvodech z nastavení ho nedostane žádný dřívější OZ. Přidělení nepřekročí limit loginu ani při dvou souběžných přiděleních (souběžný test při stavu 249 z 250). Varování vznikne od 90 %. Návrh přidělení jde před potvrzením zobrazit a upravit. |
| 10. Dashboard a měření | Dnešní a propadlé úkoly, dávky na časové ose, obsazenost, barvy semaforu, trychtýř kohort. | Dashboard se načte do 2 sekund. Čísla trychtýře pro jednu kohortu sedí s ručním přepočtem z Raynetu. Rozdělení podle typu, kraje, oboru a roku založení funguje. „David“ v číslech není. |
