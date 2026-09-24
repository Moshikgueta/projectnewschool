/* Thin fetch wrapper. JSON in, JSON out, errors as exceptions carrying the
   server's Hebrew message and code. Nothing is cached in the browser: the
   server is the source of truth for identity, access and progress. */

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined || method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body || {});
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new ApiError('אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.', 0, 'offline');
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || (data && data.ok === false && res.status >= 400)) {
    const msg = (data && data.error) || (res.status === 404 ? 'לא נמצא.' : 'משהו השתבש בשרת.');
    const err = new ApiError(msg, res.status, data && data.code);
    if (res.status === 401) window.dispatchEvent(new CustomEvent('ns-auth-lost'));
    throw err;
  }
  return data || {};
}

/* One id per submission, so a double click or a retried request is one
   attempt on the server (attempts.client_id is unique per student). */
export function clientId() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return 'c' + [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}
