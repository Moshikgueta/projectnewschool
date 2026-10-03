# New School design system

> Status: **Brand audit complete; brand tokens BLOCKED on official assets.**
> Rule for this project: the platform must _be_ New School, not be inspired by it.
> No colour, logo treatment or typeface is invented here. Where the official value isn't
> available yet, this document says **TBD** and names exactly what is missing.

---

## 1. Brand audit (2026-10-02)

### 1.1 What was inspected

| Source                                                                                                                                                                  | Result                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository `Moshikgueta/projectnewschool` — every file, including the 468 kB desktop dashboard, the mobile view, the generated `docs/` pages and the `.thumbnail` image | **No logo file of any kind** (no SVG/PNG/JPG/WebP/ICO/AI/EPS/PDF, no embedded `data:image`). The thumbnail is a dashboard screenshot without a logo. |
| Logo image supplied by the school in the planning conversation                                                                                                          | Inspected visually (details below). It wasn't supplied as a file, so it isn't in any repository yet and its exact pixel values couldn't be sampled.  |
| New School website (`newschool.co.il`, the domain used in staff emails)                                                                                                 | **Not inspected.** The build environment's network policy blocks the host.                                                                           |
| The 18 digital notebooks (Google Docs, listed in the staff prototype)                                                                                                   | **Not inspected.** They're in Google Drive, not in the repository.                                                                                   |
| Presentations or brand guidelines                                                                                                                                       | None found.                                                                                                                                          |

### 1.2 The logo (as observed)

- **Format seen:** square raster image.
- **Composition:** the words **NEW** (smaller, top) and **SCHOOL** (larger, bold) in white
  display lettering, centred inside a **sunburst** of thin white radiating lines.
- **Background:** a diagonal **teal-to-blue gradient** filling the square.
- **Variants observed:** only this one: white linework on the gradient square.

| Variant                                                                   | Found?                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Vector master (SVG / AI / EPS / PDF)                                      | ❌ needed                                                                      |
| Horizontal lockup (for desktop navigation, email headers)                 | ❌ needed                                                                      |
| Compact mark / square (mobile header, favicon, app icon)                  | ✅ the observed square _may_ be this; needs a high-resolution or vector source |
| White linework on **transparent** background (to place on brand surfaces) | ❌ needed                                                                      |
| Dark linework for **light** backgrounds                                   | ❌ needed. We will **not** recolour the logo ourselves to create one.          |

Open question: **is the gradient square part of the logo itself, or a background it was
exported on?** The answer decides whether the logo always appears as a tile.

### 1.3 Colours found in existing material — and the inconsistency

| Source                                                             | Colours                                                                                                                                                                                       | Assessment                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logo (observed)                                                    | teal → blue gradient; white                                                                                                                                                                   | **The only authentic brand signal.** Exact HEX/RGB unknown until sampled from a source file.                                                                                                                                                                                     |
| Staff prototype (Teacher Dashboard v2 / Mobile, `docs/index.html`) | paper `#F3F2F2`, ink `#201E1D`, cyan `#0088B0` (ramp `#E9F8FF`…`#0A303E`), magenta `#D6006C`, process yellow `#EDBB00`; functional: positive `#2E7D5B`, warning `#B4870C`, critical `#A5231F` | These come from **"Broadsheet"**, a third-party newsprint-style design system the prototype was themed with, not from New School's identity. The cyan is in the same family as the logo's teal but is **not verified** to match it. Magenta and yellow don't appear in the logo. |
| Root `index.html` redirect page                                    | `#2F6FED`, `#F4F5F8`, `#12161C`, `#6E9BFF`                                                                                                                                                    | Generic defaults, unrelated to the brand.                                                                                                                                                                                                                                        |
| Staff prototype "26-language palette"                              | a distinct hue per language                                                                                                                                                                   | **Conflicts with the brand rule** (no rainbow per language). Not carried over.                                                                                                                                                                                                   |

**Recommendation:** treat the logo's colours as canonical. Once a source file exists,
sample the gradient's endpoints, record them below, and choose **one canonical primary**
(normally the deeper, more legible end of the gradient, because it must pass contrast as
a button fill and as text). Broadsheet's palette isn't adopted. Its calm, muted
_functional_ colours may be reused as starting candidates only if they pass the harmony
and contrast checks against the real primary.

### 1.4 Typography found

| Source          | Typeface                                   | Assessment                                                              |
| --------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| Logo lettering  | Bold display face (unidentified)           | Logos are usually lettered or set in a licensed face. Ask the designer. |
| Staff prototype | Source Serif 4 + Frank Ruhl Libre (Hebrew) | Broadsheet's choice, not New School's.                                  |
| Notebooks       | unknown (Google Docs)                      | Needs inspection.                                                       |

**No official New School typeface is documented.** See §4 for the proposed choice.

---

## 2. Inputs needed to unblock (put them in `brand/`)

1. Logo master files: **SVG** preferred (or AI/EPS/PDF), every variant in §1.2.
2. Any brand guide, even informal: colour codes, logo clear space, do/don't.
3. The website's colours and fonts — or allow `newschool.co.il` in the environment's
   network settings so it can be inspected.
4. One or two digital notebooks exported as PDF/DOCX, to match their visual language.
5. Font name and licence, if the school uses one.

Until these arrive, UI work uses the **token names** below with clearly marked placeholder
values in a single file, `src/ui/tokens.css` (Phase 1: deliberately neutral greys, so
nobody mistakes them for the brand). Swapping in the official values is a one-file
change. `pnpm check:tokens` fails the build if a colour appears anywhere else. The
`<Logo />` component shows the school name as plain text until the official SVG
arrives. Placeholders must not reach production.

---

## 3. Colour tokens

### 3.1 Architecture

```
Tier 1  brand primitives   --ns-teal-500, --ns-blue-700 …   ← ONLY from official values
                           (tonal ramps 50–950 derived in OKLCH from each official value)
Tier 2  semantic tokens    --color-brand-primary, --color-surface, --color-error …
Tier 3  Tailwind theme     @theme { --color-primary: var(--color-brand-primary); … }
Components use Tier 2/3 classes only (bg-primary, text-muted). No hex in components —
enforced by a lint rule and a CI grep.
```

Tokens live in one file: `src/ui/tokens.css`.

### 3.2 Semantic tokens

| Token                                      | Maps to                                           | Value                                                               |
| ------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------- |
| `--color-brand-primary`                    | canonical logo colour (deep end)                  | **TBD — from logo source**                                          |
| `--color-brand-primary-hover`              | primary ramp, one step darker                     | derived                                                             |
| `--color-brand-primary-active`             | two steps darker                                  | derived                                                             |
| `--color-brand-primary-light`              | primary ramp 50–100 (tinted fills, selected rows) | derived                                                             |
| `--color-brand-secondary`                  | second logo gradient colour (light end)           | **TBD — from logo source**                                          |
| `--color-brand-secondary-hover` / `-light` | secondary ramp                                    | derived                                                             |
| `--color-brand-accent`                     | used sparingly: highlights, progress, focus ring  | **TBD** — logo gradient endpoint or white-on-brand; never a new hue |
| `--color-on-brand`                         | text/icons on brand fills                         | white (as in logo), contrast-checked                                |
| `--color-background`                       | app background                                    | neutral, faintly tinted toward primary — derived                    |
| `--color-surface`                          | cards, notebook pages                             | white                                                               |
| `--color-surface-secondary`                | inset areas, table headers                        | neutral ramp                                                        |
| `--color-text-primary`                     | body text                                         | near-black neutral — derived                                        |
| `--color-text-secondary`                   | supporting text                                   | neutral ramp, ≥ 4.5:1                                               |
| `--color-text-muted`                       | captions, metadata                                | neutral ramp, ≥ 4.5:1 on surface                                    |
| `--color-border`                           | hairlines, input borders                          | neutral ramp, ≥ 3:1 for inputs                                      |
| `--color-focus-ring`                       | keyboard focus                                    | brand primary, ≥ 3:1 against adjacent colours                       |
| `--color-success` / `-light` / `-ink`      | correct answer, completed                         | functional, harmonised                                              |
| `--color-warning` / `-light` / `-ink`      | due soon, almost right                            | functional, harmonised                                              |
| `--color-error` / `-light` / `-ink`        | incorrect, validation error                       | functional, harmonised                                              |
| `--color-info` / `-light` / `-ink`         | tips, neutral notices                             | derived from the **brand** primary ramp, not a new blue             |

**Functional colours:** muted, same lightness/chroma register as the brand; validated
for WCAG 2.2 contrast (text ≥ 4.5:1, UI ≥ 3:1). Colour is never the only signal: every
feedback state also has an icon and text ("Correct", "Not quite").

### 3.3 Canonicalisation procedure (when the logo file arrives)

1. Sample the gradient endpoints from the vector source (not a screenshot) and record
   HEX + RGB here.
2. Compare with the website and notebooks; list any variants; recommend one canonical
   value per role and get sign-off from the school.
3. Generate OKLCH ramps; check contrast of every text/background pairing in CI
   (a small script asserts the matrix).
4. Replace placeholders in `tokens.css`. Nothing else in the codebase changes.

---

## 4. Typography

**Proposed (pending confirmation that no official font exists): one family, IBM Plex
Sans** with its Hebrew and Arabic companions (Plex Sans, Plex Sans Hebrew, Plex Sans
Arabic; Latin and Greek in the base family). Reasons:

- It covers **every script on the roadmap** (Latin with Spanish/French/German/Italian
  diacritics, Greek, Hebrew, Arabic) in one designed family, so mixed-direction pages
  look like one voice instead of a patchwork of fallbacks.
- It's an open licence (SIL OFL) and self-hosted with `next/font`, so no requests to
  Google from students' browsers.
- It's highly legible at small sizes on phones, and calm and adult rather than playful.
- One family: no decorative second font. The logo provides the display character.

If New School has an official typeface with a web licence, it replaces Plex here and in
`tokens.css`. Nothing else changes.

| Role                    | Token                | Size / line-height (mobile → desktop) | Weight |
| ----------------------- | -------------------- | ------------------------------------- | ------ |
| Display (welcome)       | `--text-display`     | 32/38 → 44/52                         | 600    |
| Page title              | `--text-title`       | 26/32 → 32/40                         | 600    |
| Section heading         | `--text-heading`     | 20/28 → 24/32                         | 600    |
| Sub-heading             | `--text-subheading`  | 17/24 → 18/26                         | 600    |
| Body / notebook reading | `--text-body`        | 17/28 (both)                          | 400    |
| Exercise instruction    | `--text-instruction` | 17/26                                 | 500    |
| UI label / button       | `--text-label`       | 15/20                                 | 500    |
| Caption / metadata      | `--text-caption`     | 13/18                                 | 400    |

Body text is 17 px rather than 16 because Hebrew and Arabic need the extra size to
match Latin readability. Reading measure is capped at ~68ch.

---

## 5. Logo usage rules

- Use **only official files**. Never stretch, distort, recolour, redraw, crop, or add
  shadows, glows, outlines or gradients that aren't part of the asset.
- Preserve the aspect ratio. Set **either** width **or** height, never both.
- **Clear space:** use the official rule if one exists. Otherwise, provisionally, a
  margin equal to the height of the letters "NEW" on all sides.
- **Minimum size:** square mark ≥ 32 px (favicon uses the official small version if
  provided); horizontal lockup ≥ 120 px wide.
- The logo is rendered by a single `<Logo variant="horizontal|mark" />` component. No
  page imports logo files directly.

| Place                                | Variant                                                                                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login / auth screens                 | full logo, prominent, on a brand panel or neutral background (per available variant)                                                                |
| Desktop navigation                   | horizontal lockup _(needed)_; until it exists, the square mark plus the text "New School" set in the UI font. This is **not** a redraw of the logo. |
| Mobile header                        | square mark                                                                                                                                         |
| Student / teacher / admin dashboards | in navigation (consistent position, top start)                                                                                                      |
| Loading and empty states             | mark, small, static (respecting reduced motion)                                                                                                     |
| Auth emails (Supabase templates)     | hosted PNG export of the official logo                                                                                                              |
| Favicon / app icon / PWA             | square mark                                                                                                                                         |

---

## 6. Visual principles

- **Neutral background → white surface → brand accents → strong brand primary actions.**
  Brand colour frames the experience; it never floods a reading surface.
- Primary brand colour for: primary buttons, active navigation, selected states,
  progress highlights, key section markers, focus ring.
- Secondary/accent colours sparingly: one per component at most.
- Notebook and workbook pages: white surface, generous margins, body text at reading
  size. They use the same components as the dashboard, not a separate microsite style.
- Premium = spacing, restraint, consistent alignment and good type, not decoration. No
  stock illustrations, mascots or confetti.

### Course and language differentiation

No per-language colour schemes. A course is identified by:

1. its **language code chip** (`ES`, `DE`, `AR`) in brand-neutral styling,
2. an optional **subtle tint** from the _brand_ ramp (e.g. primary-50 vs secondary-50),
3. an icon or small accent marker.

Spanish never turns red and yellow; German never turns black, red and gold.

---

## 7. Components

Built on React Aria Components (behaviour and accessibility), styled only with tokens.

**Buttons:** exactly three variants, used everywhere.

| Variant         | Use                                                       | Look                                                      |
| --------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| Primary         | Continue · Start practice · Open workbook · Submit answer | brand-primary fill, on-brand text                         |
| Secondary       | Review · View vocabulary · Open notebook                  | brand-primary-light fill or primary outline, primary text |
| Tertiary / link | See all · Back · Skip for now                             | text only, primary colour, underline on hover             |

States for every variant: default, hover, focus-visible (2 px focus ring + offset),
active/pressed, disabled (opacity + `aria-disabled`, still focusable when it explains
why), loading (spinner, label kept, `aria-busy`). Sizes: `md` (44 px, the default and
the minimum touch target on mobile) and `sm` (36 px, desktop dense tables only).

**Inventory (Phase 2 unless noted):** Logo · AppShell (desktop side rail / mobile bottom
tab bar) · TopBar (course switcher, notifications, profile) · Button · IconButton · Link ·
TextField · Textarea · Select · Checkbox · Radio · Switch · Card (+ CourseCard,
ActivityCard) · Badge/Tag · LanguageChip · ProgressBar · ProgressRing · Stat · Tabs ·
Modal/Dialog · Drawer (mobile) · Toast · InlineAlert (info/success/warning/error) ·
Table (teacher) · Avatar · Skeleton · Spinner · EmptyState · ErrorState · Pagination.
**Content blocks (Phase 3):** see CONTENT-MODEL.md. **Exercise components and feedback
states (Phase 4):** idle, answered, checking, correct, partially correct, incorrect (with
retry), revealed, disabled.

**Icons:** one library: **Phosphor**, one weight (regular; fill for active nav only).
Directional icons are mirrored in RTL. No emoji in navigation or core UI.

---

## 8. RTL and multilingual layout

- The interface direction follows the **UI locale** (`<html dir>`). Content direction is
  set **per block** from its `lang` (ADR-009), so a Hebrew interface can show an
  LTR Spanish dialogue and an Arabic course can have Hebrew instructions.
- Logical CSS only: Tailwind `ms-/me-/ps-/pe-/start-/end-`, never `ml-/mr-/left-/right-`
  (lint-enforced).
- Inline foreign words in instructions are wrapped in `<bdi lang="…">`.
- Numbers, progress bars and sliders run in the reading direction of the UI.

## 9. Accessibility (WCAG 2.2 AA)

Semantic landmarks and headings; every control labelled; visible focus everywhere;
full keyboard operation including all exercises; touch targets ≥ 44 px; exercise
feedback announced via `aria-live="polite"`; every drag interaction has a
tap-to-select/tap-to-place alternative (the default on touch); audio has transcripts;
`prefers-reduced-motion` disables non-essential motion; contrast verified by script;
axe checks in Playwright.

## 10. `/design-system` reference page

An internal route (Phase 2) rendering: logo variants (official files only), the colour
palette with HEX values and contrast ratios, the type scale, buttons in all states,
inputs, cards, badges, progress indicators, navigation (desktop and mobile), content
blocks, exercise states with success/error feedback, modals, loading, empty and error
states, all in LTR and RTL.

Access: available in local and preview builds; in staging/production only to `admin`
and `pedagogical_manager` (server-side role guard), `noindex`.

## 11. Brand consistency check (definition of done for every UI page)

Copied into the pull-request template:

- [ ] Official logo, correct variant, unmodified, with clear space
- [ ] Only tokens used, with no raw hex (CI grep passes)
- [ ] Only approved brand and functional colours
- [ ] Looks like the same product as the other screens (same shell, type, buttons, cards)
- [ ] Recognisably New School; brand present without hurting readability
- [ ] Interactive states accessible (focus, contrast, keyboard)
- [ ] Verified at 375 px, 768 px and 1280 px, in LTR **and** RTL
