---
name: Lead management A4M
description: Liquid Glass controls floating over solid, legible data plates for managing IČO ownership.
colors:
  ink: "#0b1b33"
  accent: "#f5c518"
  accent-hover: "#ffd43a"
  accent-50: "#fdf1c8"
  accent-100: "#fcecb5"
  white: "#ffffff"
  ground: "#f2f3f5"
  text-2: "#3d4a63"
  text-2-plate: "#4a5670"
  text-3: "#5f6b80"
  text-placeholder: "#55617a"
  text-disabled: "#5a6680"
  row-hover: "#f5f6f7"
  line: "rgb(11 27 51 / 0.08)"
  line-2: "rgb(11 27 51 / 0.1)"
  line-strong: "rgb(11 27 51 / 0.14)"
  line-field: "rgb(11 27 51 / 0.2)"
  glass-fill: "rgb(255 255 255 / 0.45)"
  glass-fill-strong: "rgb(255 255 255 / 0.72)"
  glass-rim: "rgb(255 255 255 / 0.62)"
  plate-fill: "rgb(255 255 255 / 0.9)"
  sheet-fill: "rgb(255 255 255 / 0.94)"
  scrim: "rgb(11 27 51 / 0.26)"
  state-v_poolu: "#b8bec7"
  state-ve_filtru: "#959ba6"
  state-u_robota_ocisteni: "#f7dd82"
  state-superuser: "#f5c518"
  state-login_oz: "#0b1b33"
  state-vraceno: "#676e7b"
  state-odvlastneno: "#2a4a80"
  state-plovak: "#778db8"
  state-karantena: "#495e8c"
  state-ztraceno: "#e8ebef"
  state-zakaznik: "#a07700"
  state-neaktivni_ico: "#474c55"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.2
  lead:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.35
    fontFeature: "tnum"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.2
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
    fontSize: "13px"
rounded:
  tag: "11px"
  sheet: "16px"
  control: "22px"
  plate: "22px"
  panel: "24px"
  float: "28px"
  toolbar: "30px"
  pill: "999px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "24px"
  space-6: "32px"
  space-7: "48px"
  shell-inset: "12px"
  shell-gap: "16px"
  plate-pad: "22px 24px"
  control-h: "44px"
  row-h: "52px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "{spacing.control-h}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary-on-plate:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "{spacing.control-h}"
  button-secondary-on-glass:
    backgroundColor: "rgb(255 255 255 / 0.5)"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "{spacing.control-h}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "{spacing.control-h}"
  field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "{spacing.control-h}"
  chip:
    backgroundColor: "{colors.glass-fill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px 0 16px"
    height: "{spacing.control-h}"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "{spacing.control-h}"
  nav-item-current:
    backgroundColor: "rgb(255 255 255 / 0.88)"
  plate:
    backgroundColor: "{colors.plate-fill}"
    rounded: "{rounded.plate}"
    padding: "{spacing.plate-pad}"
  table-row:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    height: "{spacing.row-h}"
  table-row-selected:
    backgroundColor: "{colors.accent-50}"
  tag:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.tag}"
    padding: "0 8px"
    height: "22px"
  tag-accent:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
---

# Design System: Lead management A4M

## Overview

**Creative North Star: "Glass Over the Ledger"**

The tool's controls float as glass over the work, and the data underneath stays solid and legible. Navigation, toolbars, filter chips, tabs, paging, the inspector frame, dialogs and toasts are translucent glass hovering over one calm luminous backdrop; every number, name and date sits on a nearly opaque white plate. The system is Apple's Liquid Glass applied as a functional layer over a data tool, and it is the opposite of glassmorphism: no frosted data tiles, no figures swimming on blur.

The density is a working desk on a Mac laptop in daylight. Everything a decision needs shares one screen: a floating sidebar, a title row on the backdrop, plates of content, and on the IČO list a table that scrolls under its own floating paging capsule while the company detail opens beside it. Nothing is small: every control is a 44 px capsule, body text is 15 px, table rows are 52 px.

From the A4M brand only two colours (ink #0B1B33, yellow #F5C518) and the logo are taken. The portal's "sharp corners, no shadows" rules do not apply here: corners are concentric and soft, and depth comes from glass rim light and diffuse ink shadows.

**Key Characteristics:**
- Two materials, strictly separated: glass for navigation and controls, plates for content.
- One backdrop, the only gradient in the app: a clean neutral grey with a barely visible top-to-bottom shade (#f7f8fa to #eef0f3), as in Apple's own apps. No colour fields (Thomas, 20. 11. 2026).
- Yellow is scarce: the one primary capsule per screen and the selected row.
- Every control is a full capsule 44 px high; nothing is smaller.
- State is always a filled dot plus the state name, never colour alone.
- Platform face with tabular numerals everywhere.

## Colors

A cool, nearly monochrome ink-on-white palette lit by a single warm yellow.

### Primary
- **A4M Ink** (`ink`): all text, headings, icons, links, the focus outline, the `login_oz` state and the strong tag. The darkest value on every surface.
- **A4M Signal Yellow** (`accent`): the single primary button per screen, the inner ring of the focus indicator, text selection, the `superuser` state. Hover lifts it to the brighter `accent-hover`.

### Secondary
- **Selected-Row Cream** (`accent-50`, hover `accent-100`): the background of the selected table row, the only other place yellow appears.

### Neutral
- **Neutral Ground** (`ground`): the clean grey page colour under the backdrop shade, and the page colour when the backdrop is not painted.
- **Slate Secondary** (`text-2` on the backdrop and glass, `text-2-plate` on plates): secondary text, field labels, table header labels, chip keys. The surface sets which one applies, so every pairing stays at 4.5:1 or better.
- **Quiet Slate** (`text-3`): the empty-value dash and other tertiary text. `text-placeholder` and `text-disabled` are its siblings for inputs and disabled controls.
- **Ink Hairlines** (`line` 8 %, `line-2` 10 %, `line-strong` 14 %, `line-field` 20 %): row separators, control borders on glass and the pinned-column edge, the table header rule, field borders on plates. Always ink at low opacity, so one line works on every surface.
- **Glass Whites** (`glass-fill` 45 %, `glass-fill-strong` 72 %, `glass-rim` 62 %) and **Plate Whites** (`plate-fill` 90 %, table plate 92 %, `sheet-fill` 94 %): the two materials. Glass is thin and blurred; plates are near-solid and never blurred.
- **Row Hover Grey** (`row-hover`): table row hover.
- **Ink Scrim** (`scrim`): behind open dialogs.

### State colours
Twelve IČO states, one colour each, keyed exactly as the state values (`state-v_poolu` … `state-neaktivni_ico`). Pool and filter states are greys; the robot/cleaning step is pale yellow, superuser is the brand yellow, login OZ is ink; returned, unowned, floater and quarantine walk the ink-blue range; customer is a deep ochre. Light dots (`v_poolu`, `u_robota_ocisteni`, `ztraceno` and similar) carry a 1 px ink rim at 22 % so they hold on white.

### Named Rules
**The Scarce Yellow Rule.** Yellow fills exactly one primary capsule per screen plus the selected table row (as cream). It never colours a heading, a chart band other than the superuser state, or a decorative element.

**The No-Red Rule.** The palette has no red. Errors are ink: bold ink text under the field and a doubled ink border, an ink ring dot on an error toast.

**The Dot-and-Name Rule.** A state is shown as a 10 px filled dot followed by the state name. Colour alone never carries meaning.

## Typography

**Display Font:** none distinct; headings use the platform face.
**Body Font:** the platform system stack (-apple-system / SF Pro Text first, then Segoe UI, Roboto, Helvetica Neue, Arial).
**Label/Mono Font:** ui-monospace / SF Mono for code only.

**Character:** One native face in a short, sturdy ramp. Bold weights do the hierarchy; tabular numerals are on for the whole body so IČO numbers, counts and dates align in columns.

### Hierarchy
- **Headline** (700, 30 px, 1.15, -0.01em): the page title on the backdrop (`h1`), and the single big figure on Přehled (30 px/700, line-height 1.1). A `<strong>` inside a heading inherits its weight.
- **Title** (700, 18 px, 1.2): section headings inside plates and the inspector or dialog title (`h2`).
- **Lead** (700, 17 px, 1.3): the empty-state title; key totals beside the Přehled title use 17 px at 600.
- **Body** (400, 15 px, 1.35; paragraphs 1.45): all running text, table cells, control labels. `h3` is body size at 700; `strong` is 600.
- **Label** (600, 14 px): field labels above inputs, links in a section head, `h4`; hints and errors also use 14 px.
- **Caption** (600 or 400, 13 px): table header labels, fact-grid terms, tags, small meta lines. Sentence case; nothing in the system is uppercased or letter-spaced.

### Named Rules
**The No-Small-Type Rule.** 13 px is the floor and it is reserved for labels that sit next to a larger value. Data and controls are 15 px.

**The Tabular Rule.** Body text runs with tabular numerals; numbers, IČO and dates also never wrap.

## Layout

A sticky floating sidebar (232 px wide, inset 12 px from the window) on the left; the main column to its right is a flex column with 12 px between its items and padding of 12 px top, right and bottom and 16 px toward the sidebar. The document scrolls, not the main column. The title row (`page-head`) sits on the backdrop with a 24 px left inset so the title lines up with the text inside the plates below; actions sit at its right edge, flush with the plates.

Full-window pages (the IČO list) take the window height minus the two insets and give the remainder to one work area: a table plate that fills the column and scrolls inside, and an inspector 360 px wide (320 px at 1366 px and narrower) beside it, separated by 16 px. The floating paging capsule straddles the bottom edge of the table plate (it hangs 20 px below it) and the last rows scroll under it. Plates pad 22 px vertically and 24 px horizontally.

Spacing follows a 4 px base: 4, 8, 12, 16, 24, 32, 48. Fact grids (`dl`) set label above value in two columns by default (three for the phone row), 12 × 16 px gaps.

Below 860 px the sidebar becomes a block above the content whose items wrap into rows, the main padding becomes 12 px all round, and the backdrop switches to a simpler two-field version (ink top-left, yellow bottom-right).

## Elevation & Depth

Depth is a hybrid of translucency and soft ink shadow. The backdrop is a fixed layer; glass floats above it with backdrop blur and a rim of inner light; plates sit a little lower with a quiet shadow and no blur; dialogs and toasts float highest. Shadows are always ink-tinted, diffuse and offset downward with negative spread, never hard.

### Shadow Vocabulary
- **Glass light** (`inset 1px 1px 0 rgb(255 255 255 / 0.92), inset -1px -1px 0 rgb(255 255 255 / 0.34), inset 2px 3px 6px -2px rgb(255 255 255 / 0.55), inset -2px -3px 6px -3px rgb(11 27 51 / 0.07)`): the inner rim highlight on every glass surface.
- **Glass shadow** (`0 1px 2px rgb(11 27 51 / 0.06), 0 16px 36px -14px rgb(11 27 51 / 0.2)`): sidebar, toolbar, inspector; the small version (`0 10px 24px -12px` at 22 %) for tabs, paging and glass capsules on the backdrop.
- **Thin glass shadow** (`0 0 0 1px rgb(11 27 51 / 0.08), 0 1px 2px rgb(11 27 51 / 0.1), 0 14px 30px -10px rgb(11 27 51 / 0.34)`): the paging capsule floating over table rows, with a white text halo for legibility over moving content.
- **Plate shadow** (`0 0 0 1px rgb(11 27 51 / 0.04), 0 1px 2px rgb(11 27 51 / 0.04), 0 18px 36px -22px rgb(11 27 51 / 0.22)`): every content plate.
- **Pop shadow** (`0 2px 6px rgb(11 27 51 / 0.08), 0 28px 60px -20px rgb(11 27 51 / 0.38)`): dialogs and toasts.
- **Current capsule** (`0 1px 2px rgb(11 27 51 / 0.08), 0 6px 14px -8px rgb(11 27 51 / 0.24)`): the current sidebar item, tab or segment.

### Named Rules
**The Two Materials Rule.** Glass (white 45 %, `blur(28px) saturate(180%)`, rim, inner light) is for navigation and controls only. Content always sits on a plate (white 90 %, no blur) or, inside a glass frame, on a sheet (white 94 %).

**The No Nested Glass Rule.** Glass is never placed inside glass. Controls inside a glass surface become light capsules without a blur of their own; controls on plates become white capsules with a hairline.

**The Opaque Fallback Rule.** When reduced transparency or more contrast is requested, or backdrop blur is unavailable, glass turns opaque (#f3f6fa) and plates turn fully white.

## Shapes

Concentric, soft corners: glass panels 24 px, plates 22 px, sheets inside a glass frame 16 px, so an inner shape always follows the curve of its container. Every interactive control is a full capsule (22 px radius on a 44 px height); round icon buttons (close, paging arrows) are 44 px circles. The toolbar capsule is 30 px, floating capsules (tabs, paging, toasts) 28 px, tags 11 px on a 22 px height, multi-line text areas 16 px. Borders are 1 px hairlines; plates have none and rely on their shadow. The A4M logo, yellow line art drawn for dark grounds, sits unchanged on a small ink tile (12 px radius) in the sidebar.

## Components

### Buttons
Calm, full capsules that press slightly (scale 0.98) when clicked.
- **Shape:** capsule, 44 px high, 22 px radius; 18 px sides (14 px for the compact size, still 44 px high).
- **Primary:** A4M yellow with ink text at 600, a faint ink border at 14 %, a top inner highlight and a soft drop shadow. One per screen.
- **Secondary:** follows its surface: on the backdrop a glass capsule with its own blur; inside glass a 50 % white capsule with a hairline and no blur; on plates white with an ink hairline at 16 % and a 1 px shadow. Hover brightens toward white.
- **Ghost:** text only; hover lays a 6 % ink wash.
- **Disabled:** muted text, no shadow; primary turns into an 8 % ink wash.

### Chips
- **Style:** filter chip is a capsule with a quiet key ("Stav") and a bold value ("Vše") followed by a 16 px chevron; fill and border follow the surface like secondary buttons.
- **State:** hover and open (`aria-expanded`) take the brighter fill; disabled is transparent with muted text.

### Tags
Small outlined labels, 22 px high, 13 px/600, ink hairline at 30 %. The strong variant is an ink pill with white text.

### Cards / Containers
- **Corner Style:** plates 22 px, sheets 16 px.
- **Background:** plate white 90 % (table plate 92 %), sheet white 94 %.
- **Shadow Strategy:** plate shadow (see Elevation & Depth); sheets carry only a 5 % ink edge.
- **Border:** none.
- **Internal Padding:** 22 px × 24 px.

### Inputs / Fields
- **Style:** 44 px capsule, 16 px sides, white on plates (hairline at 20 %) and 60 % white inside glass (hairline at 10 %); label 14 px/600 above, hint 14 px below.
- **Focus:** the global ring: 2 px ink outline offset 2 px with a 2 px yellow ring inside. Inside a scrolling edge the ring is drawn inset.
- **Error / Disabled:** error is an ink border doubled to 2 px with bold ink text below; disabled is a 4 % ink wash with muted text.

### Navigation
- **Sidebar:** a sticky glass panel (radius 24) inset 12 px from the window, holding the logo tile, a 13 px subtitle, the labelled items and the logout. Items are 44 px capsules, 15 px/500 with an icon; hover lays a 50 % white wash; the current item is a brighter capsule (white 88 %, current shadow, 600).
- **Tabs:** page sections on the backdrop: a glass track (radius 28) of 44 px capsules; the current one gets the same bright capsule.
- **Segmented control:** a choice inside a plate: a grey track (6 % ink) with a solid white current segment.

### Table
A single plate (radius 22) with a sticky 44 px header (13 px/600 secondary labels over a 14 % ink rule), 52 px rows of 15 px text separated by 8 % hairlines, cells padded 8 px and 20 px at the plate edges. The IČO and Název columns can be pinned with a hairline edge while the rest scroll under them. Hover is light grey; the selected row is cream. Keyboard focus draws the ink-and-yellow ring inside the row's cells.

### Floating Paging Capsule (signature)
Thin glass (white 30 %, 5 px blur, bright rim, thin glass shadow, white text halo) that straddles the bottom edge of the table plate; the last rows pass beneath it. It holds round 44 px arrow buttons, a page-number field and a page-size select. Without floating paging it sits as a regular glass capsule 12 px below the plate.

### Inspector
A glass frame beside the list holding the company name and a close button on glass, a solid sheet with the fact sections (separated by hairlines), and a stacked action area where "Změnit stav" is the only yellow capsule.

### Dialogs and Toasts
Dialogs reuse the inspector pattern: a glass frame (radius 24, pop shadow, ink scrim behind) with title, close and footer on glass and the body on a white sheet; widths 420, 560 or 880 px; footer has secondary first, primary last; they enter with a 180 ms rise and fade. Toasts are dense glass capsules (white 72 %) 56 px high at the bottom right, with a status dot and a round close button.

## Do's and Don'ts

### Do:
- **Do** put navigation and controls on glass and every piece of data on a plate or sheet.
- **Do** keep every control at 44 px high as a full capsule; use the 44 px circle for icon-only buttons.
- **Do** give each screen exactly one yellow primary capsule; place it last in a footer.
- **Do** show state as a 10 px filled dot plus the state name; add the 22 % ink rim to light dots.
- **Do** use the 4 px spacing scale (4, 8, 12, 16, 24, 32, 48) and the 12 px shell inset.
- **Do** keep radii concentric: panel 24 > plate 22 > sheet 16.
- **Do** use the single global focus ring (2 px ink outline, 2 px yellow inner ring) and draw it inset at scroll edges.
- **Do** keep the backdrop the only gradient, painted once behind everything.

### Don't:
- **Don't** put glass inside glass, or blur behind content plates.
- **Don't** use type smaller than 13 px, or 13 px for anything but labels beside a larger value.
- **Don't** use red, or colour alone, to signal errors or states.
- **Don't** use yellow for decoration, headings or a second button on the same screen.
- **Don't** paint page backgrounds; the fixed backdrop shows through on every screen, including sign-in.
- **Don't** wrap the table in another plate; it draws its own.
- **Don't** use hard offset shadows; every shadow is diffuse and ink-tinted.
