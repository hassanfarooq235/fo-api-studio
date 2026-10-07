/**
 * Authentication.
 *
 * Tokens are acquired and cached HERE, in the background process, so that
 * rendered pages (the side panel) never need to handle raw credentials:
 *  - session : no token at all, cookies from the signed-in browser session
 *  - interactive : Entra ID authorization-code + PKCE (no client secret stored)
 *  - clientCredentials : app-only client secret (stored locally, never exported)
 *  - manual : a bearer token the user pasted (stored locally, never exported)
 */

import { get, set } from '../shared/store.js';
import { STORAGE, AUTH_MODES } from '../shared/constants.js';
import { err } from '../shared/errors.js';
import { normalizeUrl } from './envs.js';

const EXPIRY_BUFFER_MS = 60 * 1000;

function baseOf(env) {
  return normalizeUrl(env.baseUrl);
}

function tenantOf(env) {
  return String(env.auth?.tenantId || '').trim() || 'organizations';
}

function defaultScope(env, mode) {
  const base = baseOf(env);
  return mode === AUTH_MODES.CLIENT
    ? `${base}/.default`
    : `${base}/user_impersonation openid profile offline_access`;
}

function scopeOf(env, mode) {
  return String(env.auth?.scope || '').trim() || defaultScope(env, mode);
}

function tokenKey(env, mode, scope) {
  return `${env.id}|${mode}|${scope}`;
}

function base64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Base64Url(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return base64url(new Uint8Array(digest));
}

function decodeJwtPayload(token) {
  const part = String(token).split('.')[1];
  if (!part) throw err('auth', 'Token has no payload segment.');
  const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* ------------------------------------------------------------------ *
 * Token acquisition
 * ------------------------------------------------------------------ */

async function fetchClientCredentials(env) {
  const clientId = String(env.auth?.clientId || '').trim();
  const clientSecret = String(env.auth?.clientSecret || '').trim();
  if (!clientId) {
    throw err('auth', 'Missing Client ID. Open the environment and enter the Entra ID application (client) ID.');
  }
  if (!clientSecret) {
    throw err('auth', 'Missing client secret. Open the environment and paste the secret you created in Entra ID.');
  }

  const scope = scopeOf(env, AUTH_MODES.CLIENT);
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantOf(env))}/oauth2/v2.0/token`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope,
      }),
    });
  } catch {
    throw err('network', 'Could not reach login.microsoftonline.com. Check your network or proxy settings.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw err('auth', describeTokenError(data, res.status));
  }
  return data;
}

async function fetchInteractive(env) {
  const clientId = String(env.auth?.clientId || '').trim();
  if (!clientId) {
    throw err('auth', 'Missing Client ID. Open the environment and enter the Entra ID application (client) ID, then add this extension’s redirect URL https://<extension-id>.chromiumapp.org/callback to it.');
  }

  const tenant = tenantOf(env);
  const scope = scopeOf(env, AUTH_MODES.INTERACTIVE);
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/callback`;

  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = await sha256Base64Url(verifier);
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));

  const authUrl =
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?` +
    new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      response_mode: 'query',
      redirect_uri: redirectUri,
      scope,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      prompt: 'select_account',
    }).toString();

  let redirect;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  } catch (e) {
    throw err('auth', `Sign-in was cancelled or blocked: ${String(e?.message || e)}`);
  }
  if (!redirect) throw err('auth', 'Sign-in did not return a result.');

  const u = new URL(redirect);
  const flowError = u.searchParams.get('error');
  if (flowError) {
    throw err('auth', describeTokenError({ error: flowError, error_description: u.searchParams.get('error_description') }, 400));
  }
  if (u.searchParams.get('state') !== state) {
    throw err('auth', 'Sign-in response could not be validated (state mismatch). Please try again.');
  }
  const code = u.searchParams.get('code');
  if (!code) throw err('auth', 'No authorization code was returned.');

  let res;
  try {
    res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        scope,
      }),
    });
  } catch {
    throw err('network', 'Could not reach login.microsoftonline.com to finish sign-in.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw err('auth', describeTokenError(data, res.status));
  return data;
}

function describeTokenError(data, status) {
  const code = data?.error || '';
  const desc = data?.error_description || '';
  const map = {
    invalid_client: 'Client ID/secret is not valid for this tenant (AADSTS7000215 or similar). Check the app registration.',
    invalid_scope: 'The requested scope was rejected. Leave the scope field blank to use the F&O default.',
    unauthorized_client: 'This app is not allowed to sign in. Enable "Allow public client flows" or add the redirect URL https://<extension-id>.chromiumapp.org/callback.',
    interaction_required: 'The tenant requires interactive consent (MFA / admin approval).',
    aadsts700016: 'The application was not found in the tenant. Use the tenant ID of the F&O environment.',
    aadsts65001: 'Admin consent is required for this permission. Ask your Entra ID administrator to grant consent.',
    aadsts7000218: 'The app registration must allow public client flows (or use a client secret).',
  };
  for (const key of Object.keys(map)) {
    if (code === key || String(desc).toLowerCase().includes(key)) return map[key];
  }
  if (desc) return desc;
  if (code) return `Token request failed (${code}).`;
  return `Token request failed with HTTP ${status}.`;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

async function readCache() {
  return get(STORAGE.TOKENS, {});
}

async function writeCache(cache) {
  await set(STORAGE.TOKENS, cache);
}

async function cachedToken(env) {
  const mode = env.auth?.mode || AUTH_MODES.SESSION;
  const scope = scopeOf(env, mode);
  const cache = await readCache();
  const entry = cache[tokenKey(env, mode, scope)];
  if (entry && entry.expires_at > Date.now() + EXPIRY_BUFFER_MS) return entry.access_token;
  if (entry && entry.expires_at > Date.now()) return entry.access_token; // still usable, will refresh next time
  return null;
}

/**
 * Return a bearer token for the environment, refreshing when needed.
 * Returns null in session mode (cookies are used instead).
 */
export async function getToken(env, { force = false, interactive = true } = {}) {
  const mode = env.auth?.mode || AUTH_MODES.SESSION;

  if (mode === AUTH_MODES.SESSION) return null;
  if (mode === AUTH_MODES.MANUAL) {
    const t = String(env.auth?.manualToken || '').trim();
    if (!t) throw err('auth', 'No bearer token saved for this environment. Paste one in the environment editor.');
    return t;
  }

  const scope = scopeOf(env, mode);
  const key = tokenKey(env, mode, scope);
  const cache = await readCache();
  const entry = cache[key];
  const fresh = !force && entry && entry.expires_at > Date.now() + EXPIRY_BUFFER_MS;
  if (fresh) return entry.access_token;

  const data = mode === AUTH_MODES.CLIENT ? await fetchClientCredentials(env) : await fetchInteractive(env);
  if (!data?.access_token) throw err('auth', 'The identity provider did not return an access token.');

  cache[key] = {
    access_token: data.access_token,
    expires_at: Date.now() + Number(data.expires_in || 3600) * 1000,
    obtained_at: Date.now(),
    scope,
  };
  await writeCache(cache);
  return data.access_token;
}

/** Non-intrusive status used for the environment badge (never triggers a login popup). */
export async function status(env) {
  const mode = env.auth?.mode || AUTH_MODES.SESSION;
  if (mode === AUTH_MODES.SESSION) {
    return { mode, ready: true, note: 'Uses your signed-in browser session for this environment.' };
  }
  if (mode === AUTH_MODES.MANUAL) {
    return { mode, ready: Boolean(env.auth?.manualToken), note: env.auth?.manualToken ? 'Using a pasted bearer token.' : 'No bearer token saved yet.' };
  }
  const scope = scopeOf(env, mode);
  const cache = await readCache();
  const entry = cache[tokenKey(env, mode, scope)];
  const expiresAt = entry ? new Date(entry.expires_at).toISOString() : null;
  const ready = Boolean(entry && entry.expires_at > Date.now() + EXPIRY_BUFFER_MS);
  return {
    mode,
    ready,
    expiresAt,
    scope,
    note: ready ? `Token valid until ${expiresAt}.` : 'No valid cached token — sign in or fetch an app token.',
  };
}

/** Decode (never verify — this is a diagnostic view) the cached token's claims. */
export async function inspect(env) {
  const mode = env.auth?.mode || AUTH_MODES.SESSION;
  if (mode === AUTH_MODES.SESSION) {
    return { claims: null, note: 'Session mode does not use a bearer token.' };
  }
  const token = mode === AUTH_MODES.MANUAL ? env.auth?.manualToken : await cachedToken(env);
  if (!token) return { claims: null, note: 'No cached token yet. Use Sign in or Get app token first.' };

  try {
    const claims = decodeJwtPayload(token);
    const out = {};
    for (const k of ['aud', 'iss', 'tid', 'oid', 'appid', 'azp', 'scp', 'roles', 'unique_name', 'preferred_username', 'name', 'ver']) {
      if (claims[k] !== undefined) out[k] = claims[k];
    }
    for (const k of ['iat', 'nbf', 'exp']) {
      if (typeof claims[k] === 'number') out[k] = new Date(claims[k] * 1000).toISOString();
    }
    out._expired = typeof claims.exp === 'number' ? claims.exp * 1000 < Date.now() : undefined;

    const problems = [];
    if (out._expired) problems.push('The token is EXPIRED.');
    const base = baseOf(env);
    if (base && out.aud && !String(out.aud).toLowerCase().includes(new URL(base).host.toLowerCase())) {
      problems.push(`aud ("${out.aud}") does not match this environment — F&O will reject the call.`);
    }
    if (mode === AUTH_MODES.INTERACTIVE && !out.scp) {
      problems.push('No "scp" (delegated scopes) claim — check that the app exposes the F&O user_impersonation scope.');
    }
    if (mode === AUTH_MODES.CLIENT && out.scp) {
      problems.push('App-only tokens carry "roles", not "scp" — expected for client credentials.');
    }
    return { claims: out, problems };
  } catch (e) {
    return { claims: null, note: `Could not decode token: ${String(e?.message || e)}` };
  }
}
