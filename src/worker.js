/* Worker entry — runs before static assets on every request
   (run_worker_first in wrangler.toml). Routes /api/staff/*, sends the bare
   domain to the dashboard, and lets everything else fall through to the
   static assets in docs/.

   There is no asset-level gate here, and that is deliberate: the dashboard
   HTML *is* the login screen, so it has to be reachable while signed out.
   The boundary is the API — every endpoint that returns school data checks
   the session itself. */

import * as login from '../functions/api/staff/auth/login.js';
import * as logout from '../functions/api/staff/auth/logout.js';
import * as me from '../functions/api/staff/auth/me.js';
import * as signup from '../functions/api/staff/auth/signup.js';
import * as resetRequest from '../functions/api/staff/auth/reset-request.js';
import * as resetComplete from '../functions/api/staff/auth/reset-complete.js';
import * as users from '../functions/api/staff/users.js';
import * as user from '../functions/api/staff/user.js';
import * as bootstrap from '../functions/api/staff/bootstrap.js';

const ROUTES = {
  'POST /api/staff/auth/login': login.onRequestPost,
  'POST /api/staff/auth/logout': logout.onRequestPost,
  'GET /api/staff/auth/me': me.onRequestGet,
  'POST /api/staff/auth/signup': signup.onRequestPost,
  'POST /api/staff/auth/reset-request': resetRequest.onRequestPost,
  'POST /api/staff/auth/reset-complete': resetComplete.onRequestPost,
  'GET /api/staff/users': users.onRequestGet,
  'POST /api/staff/users': users.onRequestPost,
  'POST /api/staff/bootstrap': bootstrap.onRequestPost
};

/* /api/staff/users/<id> and /api/staff/users/<id>/reset — the one route shape
   with a variable in it, so it is matched rather than looked up. */
const USER_RE = /^\/api\/staff\/users\/([A-Za-z0-9_-]{1,64})(\/reset)?$/;

function userRoute(method, path) {
  const m = USER_RE.exec(path);
  if (!m) return null;
  const [, id, sub] = m;
  if (sub) return method === 'POST' ? { fn: user.onRequestPost, id } : null;
  if (method === 'PATCH') return { fn: user.onRequestPatch, id };
  if (method === 'DELETE') return { fn: user.onRequestDelete, id };
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    const handler = ROUTES[request.method + ' ' + path];
    if (handler) return handler({ request, env });

    const byId = userRoute(request.method, path);
    if (byId) return byId.fn({ request, env, params: { id: byId.id } });

    if (path.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
    }

    /* Everything else is a static asset from docs/ — the self-contained pages
       build-standalone.js generates. They inline React, so the app boots with
       no CDN round-trip, and serving docs/ rather than the repo root keeps
       uploads/, functions/ and src/ off the public web.

       The bare domain is deliberately NOT rewritten: the asset server already
       serves index.html at '/', and it 307s any '*.html' request to the
       extensionless form — so rewriting '/' to '/index.html' bounces the
       browser straight back to '/', forever. */
    return env.ASSETS.fetch(request);
  }
};
