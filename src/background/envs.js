/**
 * Environment store.
 *
 * Environments are background-owned: client secrets and pasted bearer tokens are
 * never returned to the side panel (see redact()), only used when a request is sent.
 */

import { get, set } from '../shared/store.js';
import { STORAGE } from '../shared/constants.js';
import { err } from '../shared/errors.js';

function newId() {
  return globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : `env_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Accepts a bare host or a full URL, returns a clean base URL (no trailing slash).
 * Rejects anything that is not a plausible web origin (the WHATWG URL parser is
 * lenient enough to accept e.g. "https://not a url !!").
 */
export function normalizeUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (u.username || u.password) return ''; // no credentials in a base URL
    // DNS-ish host check: letters, digits, hyphens and dots only.
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(u.hostname)) return '';
    if (u.search || u.hash) return '';
    return u.href.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** Strip secrets before anything leaves the background process. */
function redact(env) {
  return {
    id: env.id,
    name: env.name,
    baseUrl: env.baseUrl,
    company: env.company,
    variables: (env.variables || []).map((v) => ({ ...v })),
    auth: {
      mode: env.auth?.mode || 'session',
      tenantId: env.auth?.tenantId || '',
      clientId: env.auth?.clientId || '',
      scope: env.auth?.scope || '',
      hasSecret: Boolean(env.auth?.clientSecret),
      hasToken: Boolean(env.auth?.manualToken),
    },
  };
}

export async function list() {
  const envs = await get(STORAGE.ENVS, []);
  return envs.map(redact);
}

export async function getRaw(id) {
  const envs = await get(STORAGE.ENVS, []);
  return envs.find((e) => e.id === id) || null;
}

/**
 * Create or update an environment.
 * When `clientSecret` / `manualToken` are omitted or empty, the previously
 * stored value is kept (the editor sends blanks for untouched secrets).
 */
export async function save(env) {
  const baseUrl = normalizeUrl(env.baseUrl);
  if (!baseUrl) throw err('input', 'Base URL must be a valid http(s) URL, e.g. https://contoso.operations.dynamics.com');
  if (!String(env.name || '').trim()) throw err('input', 'Environment name is required.');

  const envs = await get(STORAGE.ENVS, []);
  const id = env.id || newId();
  const idx = envs.findIndex((e) => e.id === id);
  const existing = idx >= 0 ? envs[idx] : { auth: {} };

  const merged = {
    id,
    name: String(env.name).trim(),
    baseUrl,
    company: String(env.company || '').trim(),
    auth: {
      mode: env.auth?.mode || 'session',
      tenantId: String(env.auth?.tenantId || '').trim(),
      clientId: String(env.auth?.clientId || '').trim(),
      scope: String(env.auth?.scope || '').trim(),
      clientSecret: env.auth?.clientSecret || existing.auth?.clientSecret || '',
      manualToken: env.auth?.manualToken || existing.auth?.manualToken || '',
    },
    variables: (env.variables || [])
      .filter((v) => v && String(v.name || '').trim())
      .map((v) => ({
        name: String(v.name).trim(),
        value: String(v.value ?? ''),
        secret: Boolean(v.secret),
      })),
    createdAt: existing.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  if (idx >= 0) envs[idx] = merged;
  else envs.push(merged);

  await set(STORAGE.ENVS, envs);
  const active = await get(STORAGE.ACTIVE, null);
  if (!active || !envs.some((e) => e.id === active)) await set(STORAGE.ACTIVE, id);

  return redact(merged);
}

export async function remove(id) {
  const envs = await get(STORAGE.ENVS, []);
  const next = envs.filter((e) => e.id !== id);
  await set(STORAGE.ENVS, next);

  const tokens = await get(STORAGE.TOKENS, {});
  for (const key of Object.keys(tokens)) {
    if (key.startsWith(`${id}|`)) delete tokens[key];
  }
  await set(STORAGE.TOKENS, tokens);

  const active = await get(STORAGE.ACTIVE, null);
  if (active === id) await set(STORAGE.ACTIVE, next[0]?.id || null);
}

export async function getActiveId() {
  const active = await get(STORAGE.ACTIVE, null);
  const envs = await get(STORAGE.ENVS, []);
  if (active && envs.some((e) => e.id === active)) return active;
  return envs[0]?.id || null;
}

export async function setActiveId(id) {
  await set(STORAGE.ACTIVE, id);
}
