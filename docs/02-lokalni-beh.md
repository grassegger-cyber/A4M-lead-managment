# Místní běh aplikace

Aplikace zatím běží jen na Thomasově Macu. Tento dokument říká, jak ji spustit, kde leží data a v čem se místní varianta liší od cloudového návrhu (`01-navrh-reseni.md`).

## Jak spustit

```
./scripts/install-deps.sh     # jednou, a pak po každé změně závislostí
npm run dev                   # http://127.0.0.1:5180
```

- Závislosti instaluj vždy skriptem `scripts/install-deps.sh`, ne příkazem `npm install`. Samotné `npm install` nahradí odkaz `node_modules` skutečnou složkou a iCloud ji začne nahrávat a odkládat (soubory pak nejdou číst).
- Při prvním otevření aplikace nabídne stránku **Nastavení hesla** (aspoň 8 znaků). Po nastavení jste rovnou přihlášeni. Přihlášení vydrží 12 hodin.
- Smyšlená data na vyzkoušení: **nejdřív zastavte aplikaci**, pak `npm run seed -- --count 10000` a aplikaci znovu spusťte. Když už v databázi nějaká IČO jsou, skript nic nezapíše; s `--force` přidá další smyšlená IČO vedle nich (historii nejde mazat, proto nic nepřepisuje).
- Sestavená verze: `npm run build` a `npm start` (stejná adresa). Pro běžné používání je vhodnější než `npm run dev`: nesleduje změny souborů a po ukončení (Ctrl+C) databázi řádně zavře.
- Adresa je `http://127.0.0.1:5180`. Funguje i `http://localhost:5180`, ale přihlášení platí pro každou z adres zvlášť, proto používejte jednu. Z jiného počítače se do aplikace dostat nejde, požadavek odjinud server odmítne.
- Po každé aktualizaci kódu aplikaci zastavte a spusťte znovu. Změny databáze (`supabase/migrations`) se provádějí jen při startu.

### Jeden proces na databázi

Databázi smí mít otevřenou jen jeden proces. Dva procesy nad stejnou složkou by si navzájem přepisovaly data, a to bez jakékoli chyby. Aplikace si proto při startu vytvoří soubor `data.nosync/pglite.lock` se svým číslem procesu a při ukončení ho smaže. Když je databáze otevřená a spustíte `npm run seed` nebo druhou aplikaci nad stejnou složkou, skončí hned s hlášením, který proces databázi drží.

Když aplikace spadne, zámek po ní zůstane. Při dalším startu se pozná, že proces už neběží, a zámek se převezme sám. Jen kdyby hlášení o obsazené databázi přišlo, přestože žádná aplikace neběží, smažte soubor `data.nosync/pglite.lock` ručně.

## Kontroly

```
npm run check     # typy
npm test          # testy (databáze v paměti nebo v dočasné složce, na místní data nesahají)
npm run build     # sestavení
```

## Kde leží data

Vše je ve složce `data.nosync/` v kořeni projektu (jde změnit proměnnou `DATA_DIR`):

- `data.nosync/pglite/` – databáze,
- `data.nosync/auth.json` – otisk hesla (scrypt), ne heslo samotné.

Přípona `.nosync` říká iCloudu, aby složku nenahrával. Složka je v `.gitignore`, do repozitáře se nedostane. Stejně jsou ošetřené `node_modules.nosync`, `.svelte-kit.nosync` a `build.nosync`.

Složku `data.nosync/` a v ní `pglite/` aplikace při startu nastaví tak, aby do nich směl jen vlastník (práva 700). Soubory databáze uvnitř mají volnější práva, chrání je až tato složka.

Zapomenuté heslo: zastavte aplikaci, smažte `data.nosync/auth.json` a při dalším spuštění nastavte nové. Data zůstanou, všechna dřívější přihlášení tím skončí. Když soubor `auth.json` existuje, ale nejde přečíst nebo je poškozený, aplikace zůstane zamčená a stránku pro nastavení hesla nenabídne. Řešení je stejné: zastavit, soubor smazat, spustit.

Záloha místní databáze zatím není. Kopii uděláte zkopírováním složky `data.nosync/` při zastavené aplikaci. Kopie si omezení přístupu nenese: uložte ji jen tam, kam nemá přístup nikdo jiný.

## Známá omezení místní varianty

- Přihlašovací cookie platí pro adresu `127.0.0.1` bez ohledu na port. Prohlížeč ji tedy pošle i jinému webovému serveru, který na tomto počítači poběží na jiném portu, a ten by s ní mohl aplikaci ovládat. Dokud jsou v aplikaci jen smyšlená data, je to přijaté riziko; před nahráním ostrých dat je potřeba rozhodnout, jestli přihlášení svázat s adresou včetně portu.
- Požadavky bez hlavičky `Origin` (posílají je programy, ne webové stránky) kontrola původu propustí; bez platného přihlášení je server odmítne. Program, který běží pod vaším účtem na tomto počítači a přihlašovací cookie získá, se k datům dostane.
- `npm run dev` potřebuje balík `fsevents`, jinak sleduje soubory dotazováním a zatěžuje procesor. Skript `scripts/install-deps.sh` na chybějící balík upozorní.

## Čím se místní varianta liší od cloudového návrhu

| Oblast | Cloudový návrh | Místní varianta |
|---|---|---|
| Databáze | Supabase (Postgres, Frankfurt) | PGlite: Postgres běžící uvnitř aplikace, soubory v `data.nosync/pglite` |
| Migrace | ručně s náhledem do Supabase | stejné soubory `supabase/migrations/*.sql`, aplikace je při startu provede sama, každý jednou (tabulka `schema_migrations`) |
| Server | statická aplikace + funkce `api` v Supabase | SvelteKit se serverem (adapter-node), jedna adresa `POST /api` s `{ method, args }` |
| Přihlášení | whitelist uživatelů, heslo a 2FA | jedno heslo, bez 2FA; tabulka `users` zatím není, v auditu je autor „Správce“ |
| Plánovač | pg_cron každou minutu | zatím žádný |
| Zálohy | noční šifrované do R2 | zatím žádné |
| Ochrana tabulek | RLS bez politik | soubory databáze chrání práva složky (jen vlastník) a zámek jednoho procesu |
| Přístup | internet, HTTPS | jen tento počítač (`127.0.0.1`), jiný původ požadavku server odmítne |

Co zůstává stejné: schéma tabulek, stavový automat s jedinou přechodovou funkcí, historie a audit jen pro zápis (trigger brání úpravě i mazání), obchodní pravidla v tabulkách `settings` a `state_transitions`, vlastní API vrstva.

Migrace jsou psané jako běžný Postgres, aby šly později nahrát do Supabase beze změny. Ověřené je to zatím jen v PGlite, ne proti Supabase.
