/**
 * Outbound HTTP for the extension.
 *
 * Every request the panel makes is executed here so that:
 *   - bearer tokens are attached in the background and never leave it, and
 *   - host permissions (CORS bypass) apply, since this runs with them.
 */

import { get } from '../shared/store.js';
import { STORAGE, AUTH_MODES } from '../shared/constants.js';
import { err } from '../shared/errors.js';
import { originOf } from '../shared/url.js';
import { getToken } from './auth.js';

const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD']);
const CSRF_PROTECTED = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

/* ------------------------------------------------------------------ *
 * Anti-CSRF handshake (session / cookie auth only)
 *
 * Dynamics 365 F&O rejects cookie-authenticated writes unless the client
 * first asks for an anti-forgery token:
 *   1. GET   <endpoint>   with header  x-csrf-token: fetch
 *   2. read  <x-csrf-token> from the response headers
 *   3. POST/PATCH/PUT/DELETE  with the same header carrying the token
 * Bearer-token requests never need this (there is no cookie to forge).
 * ------------------------------------------------------------------ */

const csrfCache = new Map(); // origin -> token

/** Cheap endpoint that still runs the OData middleware issuing the token. */
function csrfProbeUrl(raw) {
  try {
    const u = new URL(raw);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.includes('data')) return `${u.origin}/data/`; // service root: tiny listing
    return u.href;
  } catch {
    return raw;
  }
}

/** Returns a token for the URL's origin, or null when the server issues none. */
async function acquireCsrf(url, signal, force = false) {
  const origin = originOf(url);
  if (!origin) return null;
  if (!force) {
    const cached = csrfCache.get(origin);
    if (cached) return cached;
  }

  let res;
  try {
    res = await fetch(csrfProbeUrl(url), {
      method: 'GET',
      headers: { 'x-csrf-token': 'fetch' },
      credentials: 'include',
      signal,
      redirect: 'follow',
    });
  } catch {
    return null; // best effort — the real request reports the real error
  }

  const token = res.headers.get('x-csrf-token');
  // The probe body (possibly a whole entity set) is never needed — discard it.
  try {
    await res.body?.cancel?.();
  } catch {
    /* ignore */
  }
  if (!token || !token.trim() || token.trim().toLowerCase() === 'fetch') return null;
  csrfCache.set(origin, token);
  return token;
}

function invalidateCsrf(url) {
  const origin = originOf(url);
  if (origin) csrfCache.delete(origin);
}

/** Test/diagnostic hook — clears the cached anti-CSRF tokens. */
export function resetCsrfCache() {
  csrfCache.clear();
}

export async function sendRequest(spec) {
  try {
    return { ok: true, response: await perform(spec || {}) };
  } catch (e) {
    return { ok: false, error: await describeError(e, spec?.url) };
  }
}

async function perform(spec) {
  const url = String(spec.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    throw err('input', 'The request URL must start with http:// or https://.');
  }

  const method = String(spec.method || 'GET').toUpperCase();
  const timeoutMs = clamp(Number(spec.timeoutMs) || 30000, 1000, 180000);

  const headers = {};
  for (const [k, v] of Object.entries(spec.headers || {})) {
    if (k && v !== null && v !== undefined && String(v).length) headers[k] = String(v);
  }

  // Session mode needs the browser's cookies; bearer modes must not send them.
  let credentials = spec.credentials === 'include' ? 'include' : 'omit';

  if (spec.auth?.envId) {
    const envs = await get(STORAGE.ENVS, []);
    const env = envs.find((e) => e.id === spec.auth.envId);
    if (env) {
      const mode = env.auth?.mode || AUTH_MODES.SESSION;
      if (mode === AUTH_MODES.SESSION) {
        credentials = 'include';
      } else {
        const hasAuthHeader = Object.keys(headers).some((h) => h.toLowerCase() === 'authorization');
        if (!hasAuthHeader) {
          // Tokens are scoped to the environment's own host — never send one elsewhere.
          const baseOrigin = originOf(env.baseUrl);
          const reqOrigin = originOf(url);
          if (!reqOrigin || !baseOrigin || reqOrigin !== baseOrigin) {
            throw err(
              'auth',
              `Access token withheld: this request targets ${reqOrigin || 'an unusable URL'}, but the environment${env.name ? ` “${env.name}”` : ''} is configured for ${baseOrigin || 'an unusable base URL'}. Add an Authorization header manually, or point the environment at that host.`,
            );
          }
          // May launch the interactive sign-in window when no cached token exists.
          const token = await getToken(env);
          if (!token) throw err('auth', 'No access token is available. Open the Auth tab and sign in.');
          headers.Authorization = `Bearer ${token}`;
        }
      }
    }
  }

  const hasBody = spec.body !== null && spec.body !== undefined && String(spec.body).length > 0;
  const body = hasBody && !METHODS_WITHOUT_BODY.has(method) ? String(spec.body) : undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  try {
    // Cookie-authenticated writes must present the anti-CSRF token first.
    const needsCsrf = credentials === 'include' && CSRF_PROTECTED.has(method);
    let csrfToken = needsCsrf ? await acquireCsrf(url, controller.signal) : null;
    if (csrfToken) headers['x-csrf-token'] = csrfToken;

    const attempt = async () => {
      try {
        return await fetch(url, {
          method,
          headers,
          body,
          signal: controller.signal,
          credentials,
          redirect: 'follow',
        });
      } catch (e) {
        if (e?.name === 'AbortError') {
          throw err('timeout', `Request timed out after ${Math.round(timeoutMs / 1000)}s.`);
        }
        throw e; // TypeError => network/CORS, classified below
      }
    };

    let res = await attempt();

    // A 403 right after sending a token usually means the token went stale
    // (or the session was renewed) — refetch it and try exactly once more.
    if (needsCsrf && csrfToken && res.status === 403) {
      await res.text().catch(() => '');
      invalidateCsrf(url);
      const fresh = await acquireCsrf(url, controller.signal, true);
      if (fresh) {
        headers['x-csrf-token'] = fresh;
        res = await attempt();
      }
    }

    const bodyText = await res.text().catch(() => '');
    const responseHeaders = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
      bodyText,
      timeMs: Math.round(performance.now() - started),
      sizeBytes: new TextEncoder().encode(bodyText).length,
      finalUrl: res.url,
      redirected: res.redirected,
      csrf: Boolean(csrfToken),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function describeError(e, url) {
  let origin = null;
  try {
    origin = new URL(String(url)).origin;
  } catch {
    /* invalid URL — leave origin null */
  }

  let hasPermission = null;
  if (origin) {
    try {
      hasPermission = await chrome.permissions.contains({ origins: [`${origin}/*`] });
    } catch {
      hasPermission = null;
    }
  }

  if (e?.kind) {
    return { kind: e.kind, message: e.message, origin, hasPermission };
  }
  if (e?.name === 'AbortError') {
    return { kind: 'timeout', message: 'Request timed out.', origin, hasPermission };
  }
  if (hasPermission === false) {
    return {
      kind: 'permission',
      message: `The extension has no access to ${origin}. Click “Grant access” and try again.`,
      origin,
      hasPermission,
    };
  }
  return {
    kind: 'network',
    message: `Network error while calling ${origin || 'the URL'}. Check the URL, VPN/proxy and that the environment is running.`,
    origin,
    hasPermission,
  };
}
