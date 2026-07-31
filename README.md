# Teacher Dashboard

לוח מחוונים למורה — desktop and mobile views for a language-school teaching system:
students, digital notebooks (מחברות דיגיטליות) and lesson materials, in Hebrew RTL.

## Files

| File | What it is |
| --- | --- |
| `Teacher Dashboard v2.dc.html` | The full desktop dashboard — login, greeting, students list, digital notebooks, lesson materials |
| `Teacher Mobile.dc.html` | The phone view of the same system |
| `support.js` | The `dc` runtime both pages load (`<script src="./support.js">`) — generated, do not hand-edit |
| `_ds/broadsheet-…/` | The **Broadsheet** design system the project is built against: `styles.css` tokens, `_ds_bundle.js`, `_ds_manifest.json`, lint config and `readme.md` |
| `uploads/` | Source documents the content was derived from (course and notebook lists) |
| `.thumbnail` | WebP preview image |

## Running it

Both pages are self-contained documents that pull `support.js` from the same directory,
so they need to be served over HTTP rather than opened with `file://`:

```sh
python3 -m http.server 8000
```

then open <http://localhost:8000/Teacher%20Dashboard%20v2.dc.html>.

## Design system

The look follows **Broadsheet** — newsprint set for the web: Source Serif 4 on paper white,
cyan `#0088b0` and magenta `#d6006c` used small and deliberately as spot colour, hierarchy
from the serif scale and negative space rather than boxes and dividers. The full guidance,
the token set and the component list live in `_ds/broadsheet-…/readme.md`; take colours,
fonts, spacing and radii from the `var(--color-*)` / `--font-*` / `--space-*` / `--radius-*`
variables in `styles.css` rather than hard-coding values.

The dashboard pages themselves load Heebo and Assistant from Google Fonts for the Hebrew UI.

## Conventions

- `support.js` is generated from `dc-runtime` — rebuild it there, never edit it here.
- Templates use the `sc-if` / `sc-for` control elements inside `<x-dc>`; props and script
  live in the `data-props` script block at the bottom of each page.
