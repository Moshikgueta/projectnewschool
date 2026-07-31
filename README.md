# Teacher Dashboard

לוח מחוונים למורה — desktop and mobile views for a language-school teaching system:
students, digital notebooks (מחברות דיגיטליות) and lesson materials, in Hebrew RTL.

## Files

| File | What it is |
| --- | --- |
| `Teacher Dashboard v2.dc.html` | The full desktop dashboard — login, greeting, students list, digital notebooks, lesson materials |
| `Teacher Mobile.dc.html` | The phone view of the same system |
| `support.js` | The `dc` runtime both pages load (`<script src="./support.js">`) — generated, do not hand-edit |
| `_ds/broadsheet-…/` | The **Broadsheet** design system bundle — `styles.css` tokens, `_ds_bundle.js`, `_ds_manifest.json`, lint config and `readme.md`. Reference only; the pages don't link it (see [Design](#design)) |
| `vendor/` | React 18.3.1 and ReactDOM 18.3.1 UMD builds, vendored so the standalone build is offline and deterministic |
| `scripts/build-standalone.js` | Bundles each page into one self-contained file in `dist/` |
| `uploads/` | Source documents the content was derived from (course and notebook lists) |
| `.thumbnail` | WebP preview image |

## Running it

Both pages are self-contained documents that pull `support.js` from the same directory,
so they need to be served over HTTP rather than opened with `file://`:

```sh
python3 -m http.server 8000
```

then open <http://localhost:8000/Teacher%20Dashboard%20v2.dc.html>.

`support.js` bootstraps itself by fetching React 18.3.1 and ReactDOM 18.3.1 from unpkg at
runtime (with SRI), so the browser needs internet access — behind a network that blocks
unpkg the page stays blank and the console shows `[dc] failed to load React or boot`.

### Self-contained build

```sh
node scripts/build-standalone.js
```

writes `docs/dashboard.html` and `docs/mobile.html` — each one file, no server and no
network. They can be opened straight from disk, emailed, or dropped on any static host.

The build inlines the two React UMD bundles from `vendor/` ahead of `support.js`, which
makes the runtime skip its CDN fetch (`loadReactUmd` returns early when `window.React` and
`window.ReactDOM` already exist). `@babel/standalone` is deliberately left out: the runtime
only loads it for `x-import`ed JSX modules, which these pages don't use — confirmed by
loading them in a browser with the Babel request blocked.

The only thing a built page still reaches for is Google Fonts. Offline it falls back to
Georgia; everything else renders and works.

**Inlining has to escape HTML-looking tokens**, and getting this wrong fails in a way that
only shows up when the page is served. `support.js` mentions `<x-dc`, `</x-dc>` and
`<sc-raw-*>` in its own regexes, strings and comments. Inlined verbatim those land in the
document text — and the runtime re-fetches the page over HTTP and re-parses it, so it finds
the stray markers and tries to create an element named `sc-raw-*`, which throws and renders
a blank page. Under `file://` the re-fetch fails and the runtime falls back to the live DOM,
so the page looks perfect locally and is broken the moment it is hosted. The build escapes
the `<` of those tokens (and of `<script`) to `\x3c`, which leaves every value identical.
**Verify built pages over http, not file://** — that is the condition that matters.

## The site

`docs/` is the published site — GitHub Pages serves it from the `main` branch. It holds the
hand-written landing page (`docs/index.html`, which links the two views and lists the demo
logins) plus the two built pages, so the whole thing is static with no build step on
GitHub's side. `docs/dashboard.html` and `docs/mobile.html` are generated — rebuild them
with the command above rather than editing them; `docs/index.html` is a source file.

Enabling it, once per repository: **Settings → Pages → Source: Deploy from a branch →
`main` / `/docs`**. Pages on a private repository needs a paid GitHub plan; on the free
plan the repository has to be public, which also puts the prototype and its demo logins on
the open web.

Both pages open on a login screen and ship demo accounts — `yotam / ns2026` (מורה),
`office / ns2026` (אדמין), `pedago / ns2026` (מנהל פדגוגי), `noa / ns2026` (מנהלת קבלה),
`noa.cohen / ns2026` (תלמידה). These are prototype credentials against in-page demo data,
shown deliberately on the login screen; there is no backend.

## Design

The site follows **Broadsheet** — the design system in `_ds/broadsheet-…/`. Newsprint set
for the web: a `#f3f2f2` paper ground with `#201e1d` ink, cyan `#0088b0` as the interactive
accent and magenta `#d6006c` as the rarer second spot colour, hierarchy carried by the
serif scale and by space rather than by rules and boxes. The guide, the full token set and
the component list are in `_ds/broadsheet-…/readme.md`.

**Typography.** Broadsheet specifies Source Serif 4, which carries no Hebrew glyphs — on a
Hebrew RTL interface it would silently fall back to a system sans on nearly every string.
So the stack is `'Source Serif 4','Frank Ruhl Libre',Georgia,serif`: Latin sets in the
system's own face and Hebrew falls through to a Hebrew serif of the same newsprint
character. Per-character fallback does the routing, so each script gets a serif.

**Colour.** The pages carry no stylesheet to retheme — the look lived in ~1,600 inline
`style` attributes plus a few hundred values in the page script, so those were rewritten
onto `var(--color-*)` tokens declared at the top of each page. A hex is mapped by the
property it sits in: dark values as `background` become surfaces, the same values as
`color` become text.

Two deliberate departures from the guide, both because this is an operated interface rather
than a document:

- **The rail stays dark.** Broadsheet shows no dark surfaces, but the navigation rail and
  the sign-in panel need to separate from the working area. They take the system's deepest
  ink neutral, so they read as an ink panel on newsprint with knockout type — print
  language — instead of navy UI chrome.
- **Semantic and categorical colour sit outside the accents.** Pass/fail/warning states and
  the 26-language palette are information, not brand, so they keep distinct hues; every one
  is retuned to the same muted press-ink register so they sit inside the palette.

The landing page (`docs/index.html`) commits to the single light theme on purpose — a
newsprint system has no dark register to invert into — and uses the one rule pair the
system does print: the front-page thick–thin around a dateline rail.

## Conventions

- `support.js` is generated from `dc-runtime` — rebuild it there, never edit it here.
- Templates use the `sc-if` / `sc-for` control elements inside `<x-dc>`; props and script
  live in the `data-props` script block at the bottom of each page.
