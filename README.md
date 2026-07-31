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
| `uploads/` | Source documents the content was derived from (course and notebook lists) |
| `.thumbnail` | WebP preview image |

## Running it

Both pages are self-contained documents that pull `support.js` from the same directory,
so they need to be served over HTTP rather than opened with `file://`:

```sh
python3 -m http.server 8000
```

then open <http://localhost:8000/Teacher%20Dashboard%20v2.dc.html>.

`support.js` bootstraps itself by fetching React 18.3.1, ReactDOM 18.3.1 and
`@babel/standalone` 7.29.0 from unpkg at runtime (with SRI), so the browser needs internet
access — behind a network that blocks unpkg the page stays blank and the console shows
`[dc] failed to load React or boot`.

Both pages open on a login screen and ship demo accounts — `yotam / ns2026` (מורה),
`office / ns2026` (אדמין), `pedago / ns2026` (מנהל פדגוגי), `noa / ns2026` (מנהלת קבלה),
`noa.cohen / ns2026` (תלמידה). These are prototype credentials against in-page demo data,
shown deliberately on the login screen; there is no backend.

## Design

The two dashboard pages carry their styles inline: **Heebo** for headings and **Assistant**
for body text (both from Google Fonts), a light `#F4F5F8` ground, near-black `#12161C` text
and a dark navy sidebar. The whole UI is RTL.

The `_ds/broadsheet-…/` bundle is a **separate design system that these pages do not
currently use** — "Broadsheet", newsprint set for the web: Source Serif 4 on paper white
with cyan `#0088b0` and magenta `#d6006c` as spot colour. Neither page links its
`styles.css` or references its `var(--color-*)` tokens, so it is carried here as reference
material rather than as the dashboard's live styling. Its guidance, token set and component
list are in `_ds/broadsheet-…/readme.md`.

## Conventions

- `support.js` is generated from `dc-runtime` — rebuild it there, never edit it here.
- Templates use the `sc-if` / `sc-for` control elements inside `<x-dc>`; props and script
  live in the `data-props` script block at the bottom of each page.
