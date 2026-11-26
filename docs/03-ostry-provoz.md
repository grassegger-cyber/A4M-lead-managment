# Ostrý provoz (cloud)

Jak je ostrá verze postavená, co je potřeba jednou nastavit a jak se nasazuje. Stav k 26. 11. 2026: kód je hotový a ověřený místně, **na skutečném Supabase a Cloudflare zatím neběžel** (viz Neověřeno na konci).

## Jak to drží pohromadě

- **Web**: statická aplikace na Cloudflare Pages. Neobsahuje žádná data ani tajemství, jen obrazovky.
- **Přihlášení**: Supabase Auth, e-mail a heslo plus povinný kód z ověřovací aplikace (TOTP). Registrace je vypnutá.
- **Server**: jedna funkce `api` v Supabase (`supabase/functions/api`). Před každou metodou ověří, že token je platný, že relace prošla 2FA (`aal2`) a že e-mail je na seznamu povolených. Bez toho nevydá nic.
- **Databáze**: Postgres v Supabase (Frankfurt). Všechny tabulky mají RLS bez politik, takže přímo z prohlížeče se k datům nedostane nikdo ani s platným přihlášením. Funkce `api` je jediná cesta.
- **Data**: do databáze je nahrává jen přihlášený uživatel přes Import. Přes GitHub ani přes repozitář žádná data nejdou. Excel se čte i zapisuje v prohlížeči.

## Co nastaví Thomas (jednou)

1. **Supabase**: projekt „Lead management“. Ověřit v Project Settings → General, že region je Frankfurt (eu-central-1). Jiný region znamená založit projekt znovu, přesunout nejde.
2. **Dva uživatelé**: Supabase → Authentication → Users → Add user → Create new user. Zadat e-mail a silné heslo (aspoň 12 znaků), nechat zaškrtnuté Auto Confirm User. Udělat pro oba. 2FA si každý nastaví sám při prvním přihlášení do aplikace.
3. **GitHub Secrets** (repozitář → Settings → Secrets and variables → Actions → New repository secret). Hodnoty nikdy neposílat do chatu.

| Název | Kde ho vzít |
|---|---|
| `SUPABASE_PROJECT_REF` | Supabase → Project Settings → General → Project ID |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API Keys → anon / publishable |
| `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens → Generate new token |
| `SUPABASE_DB_PASSWORD` | heslo databáze zadané při založení projektu (jde změnit v Project Settings → Database) |
| `ALLOWED_EMAILS` | e-maily obou uživatelů oddělené čárkou |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare → Workers & Pages → vpravo Account ID |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → šablona „Edit Cloudflare Workers“ nebo vlastní s právem Account → Cloudflare Pages → Edit |

4. **Účty Supabase, GitHub a Cloudflare** musí mít samy zapnuté 2FA. Kdo ovládne některý z nich, dostane se k datům nebo k nasazení.

## Nasazení

- `Nasazení` (`.github/workflows/nasazeni.yml`): při každém pushi do `main` a ručně. Kontrola typů, testy, sestavení, funkce `api`, nastavení přihlášení (registrace vypnutá, TOTP zapnuté, heslo aspoň 12 znaků), web. Adresa webu: `https://a4m-lead-management.pages.dev` (jméno projektu jde změnit proměnnou `CLOUDFLARE_PAGES_PROJECT`, další adresy, např. vlastní doména, patří do proměnné `APP_ORIGINS`).
- `Migrace databáze` (`migrace.yml`): jen ručně. Nejdřív spustit bez zaškrtnutí (náhled), přečíst výpis, pak znovu se zaškrtnutým „Zapsat“.
- `Údržba` (`udrzba.yml`): jednou denně malý dotaz, aby Supabase na tarifu zdarma projekt po 7 dnech nečinnosti nepozastavil.

Pořadí při prvním spuštění: tajemství → Migrace (náhled, pak zápis) → Nasazení → přihlásit se, nastavit 2FA → Import.

Ruční spouštění a plánovaná údržba fungují jen z výchozí větve repozitáře, proto musí být výchozí větev `main`.

## Místní běh pro vývoj

```
./scripts/install-deps.sh
npm run dev          # http://127.0.0.1:5180, bez přihlášení, databáze v paměti (po restartu prázdná)
```

- Bez proměnné `VITE_SUPABASE_URL` odpovídá na `/api` vývojový server sám (stejný kód jako funkce `api`, databáze PGlite). Slouží jen k práci na obrazovkách se smyšlenými daty.
- Trvalá místní data: `npm run seed -- --count 3000` a pak `DEV_DATA_DIR=./data.nosync/pglite npm run dev`.
- Testy proti skutečnému Postgresu (stejný motor jako Supabase): `TEST_PG_URL=postgres://… npm test`.

## Zapomenuté heslo

Na přihlašovací stránce odkaz „Zapomněl jsem heslo“ pošle na e-mail odkaz pro nastavení nového hesla (rozhodnutí Thomase 26. 11. 2026, původní návrh počítal jen s ruční obnovou). Účet, který už má ověřovací aplikaci, musí před změnou hesla zadat její kód, takže samotný přístup do e-mailu nestačí. Supabase na tarifu zdarma posílá jen několik e-mailů za hodinu. Stejný odkaz jde poslat i ze Supabase (Authentication → Users → Send password recovery).

## Ztráta telefonu s ověřovací aplikací

Supabase → Authentication → Users → uživatel → odebrat MFA faktor. Při dalším přihlášení si uživatel nastaví nový.

## Neověřeno (ověří první nasazení)

- Že `supabase db push` přijme názvy migrací ve tvaru `0001_…sql`.
- Že je funkci k dispozici proměnná `SUPABASE_DB_URL` s přímým připojením k databázi a že přes něj dotaz může běžet déle než 8 s (velký import). Náhradní cesta: tajemství `DATABASE_URL`.
- Že hlavička `x-region: eu-central-1` drží běh funkce ve Frankfurtu. Funkce vrací region v hlavičce `x-served-region`, jde to zkontrolovat.
- Názvy polí v nastavení přihlášení přes Management API (`disable_signup`, `mfa_totp_*`, `password_min_length`). Když krok selže, nastavit ručně: Authentication → Sign In / Providers (vypnout „Allow new users to sign up“) a Multi-Factor (TOTP zapnuté).
- Že denní dotaz z `Údržby` stačí proti pozastavení projektu.
- Rychlost na 90 tisících řádcích: místně prošel import 20 tisíc smyšlených řádků (nahrání, kontrola, zápis) bez potíží; limit 2 s procesoru na požadavek u funkce se projeví až v cloudu.
- Skutečná struktura kmenového Excelu. Import je postavený podle smyšleného souboru.

## Co chybí

- Noční šifrované zálohy do R2 (schváleno 19. 11. 2026, nepostaveno). Do té doby jsou ostrá data bez zálohy.
- Plánovač (pg_cron) a fronta úloh: přijdou s kroky, které je potřebují.
