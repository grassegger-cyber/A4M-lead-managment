# Místní běh aplikace

Od 26. 11. 2026 je aplikace postavená pro cloud (Supabase + Cloudflare Pages) a místní běh slouží jen k vývoji obrazovek se smyšlenými daty. Postup, nasazení a nastavení jsou v `03-ostry-provoz.md`.

Co z dřívější místní varianty zůstává:

- Závislosti se instalují skriptem `./scripts/install-deps.sh`, ne příkazem `npm install`. Samotné `npm install` nahradí odkaz `node_modules` skutečnou složkou a iCloud ji začne nahrávat a odkládat.
- Složky s příponou `.nosync` (`node_modules.nosync`, `.svelte-kit.nosync`, `build.nosync`, `data.nosync`) iCloud nenahrává a git je ignoruje.
- Místní databáze je PGlite (Postgres uvnitř procesu). Když se použije trvalá složka (`DEV_DATA_DIR`), smí ji mít otevřenou jen jeden proces; hlídá to soubor `pglite.lock` vedle ní.

Co zaniklo: přihlášení jedním heslem (`auth.json`), tabulka `sessions`, server SvelteKitu (adapter-node) a příkaz `npm start`. Stará data ve složce `data.nosync/` na Thomasově Macu jsou jen smyšlená a nejsou potřeba.
