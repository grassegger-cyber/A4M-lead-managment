---
version: 1
slug: "src-routes-layout-svelte"
primary_target: "src/routes/+layout.svelte"
related_targets: ["src/routes/+page.svelte","src/routes/ico/+page.svelte","src/routes/ico/IcoDetail.svelte","src/routes/ico/[ico]/+page.svelte","src/routes/import/+page.svelte","src/routes/import/[id]/+page.svelte","src/routes/nastaveni/+page.svelte","src/routes/audit/+page.svelte","src/routes/prihlaseni/+page.svelte","src/routes/nastaveni-hesla/+page.svelte","src/app.css"]
---

# Surface brief: the whole app (shell and every screen)

## Scope and mode

Operate. Every screen of the app: shell and navigation, Přehled (`/`), IČO list with the detail beside it (`/ico`), IČO detail page (`/ico/[ico]`), Import (`/import`, `/import/[id]`), Nastavení (`/nastaveni` and its tabs), Audit (`/audit`), Přihlášení and Nastavení hesla. Two managers at a desk on a Mac in daylight, focused sessions: read the state of the IČO pool, find a company, move it between states, decide ownership.

## Constraints

- Redesign of the look only. Every function, route, text, filter, dialog, validation and data flow stays as it is. Czech UI, dates DD. MM. RRRR.
- Approved comp: the design canvas artboards `Glass-Prehled.dc.html` and `Glass-ICO.dc.html` (canvas version 6, 20. 11. 2026). Screens without an artboard inherit the same system.
- Platform face only; no new packages.

## Direction contract

Development-only. Never copy any of this into source, comments, markup or anything the browser receives.

**THESIS.** The tool's controls float as glass over the work, and the data underneath stays solid and perfectly legible. It refuses "glassmorphism": a dashboard where every card is a frosted tile and the numbers swim on blur.

**OWN-WORLD.** Light appearance. Behind everything one clean neutral grey backdrop with a barely visible top-to-bottom shade, as in Apple's own apps; no colour fields (owner's correction, 20. 11. 2026); it is the only gradient. Two materials, strictly separated. Glass for navigation and controls only (floating sidebar, toolbar capsules, filter chips, inspector frame, floating pagination): translucent white about 45 %, backdrop blur about 28 px with saturation, a light rim with inner highlight, soft ink shadow at 10–14 %, inset 12 px from the window edge, never nested. Plates for content: white about 90 %, no blur, radius 22 px. Concentric radii: panels 24, plates 22, controls full capsules 44 px high. Ink text #0B1B33, every text on glass at least 4.5:1. A4M yellow only on the single primary capsule per screen and the selected row. State is a filled dot plus the state name. Platform face, tabular numerals in data.

**STORY.** The manager sees his data as a clean sheet with the controls hovering above it, always within reach. Scrolling a long list never pushes search, filters or paging off the screen; the detail of a company opens beside the list.

**FIRST VIEWPORT.** Přehled at 1440 × 900 without page scroll: floating glass sidebar (A4M mark, five labelled items, current item a brighter capsule); title set large on the backdrop with the key totals beside it; the states plate with one segmented bar and a two-column legend whose rows link to the list; the occupancy plate with the superuser meter and the holder breakdown; regions; latest changes and imports. IČO at 1440 × 900 with only the table body scrolling: glass toolbar capsule with search and filters, one large table plate with sticky IČO and Název columns, the glass inspector beside it with a solid sheet and "Změnit stav" as the only yellow capsule, and the glass pagination capsule straddling the bottom edge of the table plate so the last rows pass beneath it. That capsule is the signature moment.

**FORM.** Apple's Liquid Glass applied as a functional layer over a data tool. The owner pinned this direction himself after comparing three looks on the canvas, so no concept roll was run and there is no seed key.

**FINISH.** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- The A4M logo file in `static/` is drawn for dark grounds; how it sits on light glass is decided in the build.
- Semafor colours (step 6) are a proposed brand exception, to be confirmed by Thomas.
