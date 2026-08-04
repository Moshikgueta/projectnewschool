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
| `functions/` | Server side: `_shared.js` (PBKDF2, email), `_staff.js` (sessions, guards), `api/staff/*` (the endpoints) |
| `src/worker.js` | Cloudflare Worker entry — routes `/api/staff/*`, serves `docs/` for everything else |
| `schema.sql` | D1 schema: `staff_users`, `staff_sessions`, `staff_reset_tokens` |
| `scripts/e2e.mjs` | 60 end-to-end checks against a local Worker and D1 (`npm test`) |
| `scripts/create-admin.mjs` | Writes a staff account straight into D1 (`npm run admin`) — the way in, and the way back in |
| `wrangler.toml` | Worker + D1 config |

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

### With the backend

```sh
npm install
npm run schema      # apply schema.sql to the local D1
npm run dev         # build + wrangler dev, on http://localhost:8787
npm test            # build + the 60-check end-to-end suite
```

`npm run dev` serves `docs/` and the API from one origin, which is what the session
cookie needs. Create the first admin with the bootstrap endpoint below.

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

Both pages open on a login screen. **The demo accounts are gone** — login now goes to
`POST /api/staff/auth/login` and is checked against D1, so the printed `ns2026` passwords
that used to sit on the login screen were removed with them. See [Accounts and auth](#accounts-and-auth).

That makes the GitHub Pages copy a **look-only** deployment: the pages render, but no
login can succeed there, because Pages serves static files and has no API. The same
`docs/` build served by the Worker is the working system. Student and lesson data is
still in-page demo data — only accounts moved server-side so far.

## Accounts and auth

Accounts live in D1 and every rule is enforced in the Worker — the UI hiding a screen is a
convenience, the API is the boundary.

| endpoint | who | what |
| --- | --- | --- |
| `POST /api/staff/auth/login` | anyone | `{user, pass}` — username or email |
| `POST /api/staff/auth/logout` | signed in | deletes the session row, not just the cookie |
| `GET /api/staff/auth/me` | anyone | the source of truth for identity; called on every page load |
| `POST /api/staff/auth/signup` | anyone | self-signup — created **disabled**, pending an admin |
| `POST /api/staff/auth/reset-request` | anyone | mails a link. Never returns a token |
| `POST /api/staff/auth/reset-complete` | with token | `{token, pass}` — drops every session for that account |
| `GET/POST /api/staff/users` | admin | list · create with a temporary password |
| `PATCH/DELETE /api/staff/users/:id` | admin | edit · delete |
| `POST /api/staff/users/:id/reset` | admin | mint a reset link to relay by hand |
| `POST /api/staff/bootstrap` | once | the first admin |

### The first admin

Whoever has wrangler access to the database can write an account straight into it —
already a higher level of trust than any HTTP endpoint could grant, so there is no token
to arrange:

```sh
npm run admin -- --email office@newschool.co.il --pass "<strong password>" \
                 --name "אלון מנהל" --user office            # local D1
npm run admin -- --email … --pass … --name … --remote        # the deployed D1
```

Login then accepts either the email or the `--user` handle. Re-running with an email that
already exists **resets that account's password and re-enables it** — the way back in if
you lock yourself out. `--role` takes any of אדמין · מנהל פדגוגי · מורה · מנהלת קבלה ·
תלמיד and defaults to אדמין.

### The first admin, over HTTP

When wrangler access isn't at hand — someone else operates Cloudflare, say — the same
thing can be done through the API. Once, then delete the secret:

```sh
npx wrangler secret put STAFF_BOOTSTRAP_TOKEN        # any random value
curl -X POST https://<domain>/api/staff/bootstrap \
  -H 'content-type: application/json' \
  -d '{"token":"<same value>","name":"אלון","user":"office",
       "email":"office@newschool.co.il","pass":"<strong password>"}'
npx wrangler secret delete STAFF_BOOTSTRAP_TOKEN
```

The endpoint answers 409 forever once any account exists, so a forgotten secret is not a
standing door — delete it anyway.

### Email

`RESEND_API_KEY` + `EMAIL_FROM` as secrets. Without them nothing breaks: "forgot password"
tells the user to contact the office, and the admin mints a link from the users screen.

### Decisions worth knowing

- **PBKDF2** (100k iterations, per-account salt), lifted verbatim from the Spanish course
  project where it already runs in production, rather than rewritten.
- **Sessions are database rows, not signed cookies.** Disabling or deleting an account
  kills its live sessions immediately instead of at the next login — the difference that
  matters on a shared staffroom machine.
- **Session and reset tokens are stored hashed** (SHA-256): a dump of either table cannot
  be replayed as a login.
- **`reset-request` never returns the token.** That endpoint is unauthenticated, so
  echoing it back would be account takeover for anyone who can guess an address. Manual
  relay lives behind the admin guard at `POST /api/staff/users/:id/reset`.
- **Self-signup creates a disabled account**, or a stranger could mint themselves a מורה
  login and read student records.
- **8 failed attempts lock the account for 15 minutes.**
- **The last active admin cannot be demoted, disabled or deleted** — nor can you do any of
  those to the account you are signed in with.
- Wrong password and unknown username return the identical message, so the API cannot be
  used to confirm which school addresses exist.

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
- **Keep the tags balanced, and check it.** See below — one missing `</div>` cost the
  whole desktop app, silently.

### One missing `</div>` blanked the entire desktop app

Worth writing down, because the symptom pointed nowhere near the cause. After signing in,
the desktop went **blank**: the login screen disappeared, the app never appeared, no
exception was thrown, the console was clean, and `renderVals()` returned
`showStaffApp: true` the whole time. Signing in as a student worked fine.

The cause was one missing `</div>` in the login block. The HTML spec says an end tag for
an unknown element — `</sc-if>` — that meets an open `<div>` on the stack is **ignored**
outright. So `<sc-if value="{{ isLocked }}">` never closed, and the entire staff app that
follows it got parsed *inside* it. The moment you signed in and `isLocked` went false, the
staff app went with it. The student view survived only because it sits further down,
outside the broken nesting.

Two `</div>` strays remain at the end of the staff block; unmatched end tags are discarded
by the parser and change nothing. The lesson is that a file can look completely fine and
be broken in its nesting, so before blaming the runtime, check the balance:

```sh
python3 - <<'EOF'
import io
from html.parser import HTMLParser
VOID={'br','img','input','hr','meta','link','source','area','base','col','embed','param','track','wbr'}
class P(HTMLParser):
    def __init__(self): super().__init__(convert_charrefs=True); self.stack=[]; self.bad=[]
    def handle_starttag(self,t,a):
        if t not in VOID: self.stack.append((t,self.getpos()))
    def handle_endtag(self,t):
        if t in VOID: return
        if not self.stack: self.bad.append('stray </%s> line %d'%(t,self.getpos()[0])); return
        if self.stack[-1][0]!=t:
            self.bad.append('<%s> line %d closed by </%s> line %d'%(self.stack[-1][0],self.stack[-1][1][0],t,self.getpos()[0]))
            for i in range(len(self.stack)-1,-1,-1):
                if self.stack[i][0]==t: del self.stack[i:]; break
        else: self.stack.pop()
p=P(); p.feed(io.open('Teacher Dashboard v2.dc.html',encoding='utf-8').read())
print('unclosed:', [t for t,_ in p.stack] or 'none')
print('mismatched:', p.bad or 'none')
EOF
```
