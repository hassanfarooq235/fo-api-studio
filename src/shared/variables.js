/**
 * {{variable}} resolution.
 *
 * Resolution order (later wins): built-ins -> globals -> environment variables.
 * Unknown variables are left untouched so the user can see what is missing.
 */

const VAR_RE = /\{\{\s*([^{}\s]+)\s*\}\}/g;

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Dynamic + environment-aware built-in variables. */
export function builtins(env) {
  const now = Date.now();
  return {
    $baseUrl: String(env?.baseUrl || '').replace(/\/+$/, ''),
    $company: String(env?.company || ''),
    $envName: String(env?.name || ''),
    $guid: uuid(),
    $timestamp: String(Math.floor(now / 1000)),
    $isoTimestamp: new Date(now).toISOString(),
    $randomInt: String(Math.floor(Math.random() * 10000)),
  };
}

/**
 * @param {string} input
 * @param {{env?: object, globals?: Array<{name:string,value:string}>}} scopes
 * @returns {{text: string, missing: string[]}}
 */
export function resolveVars(input, { env, globals = [] } = {}) {
  if (typeof input !== 'string' || !input.includes('{{')) {
    return { text: input ?? '', missing: [] };
  }
  const map = Object.create(null);
  Object.assign(map, builtins(env));
  for (const g of globals) {
    if (g && g.name) map[g.name] = String(g.value ?? '');
  }
  for (const v of env?.variables || []) {
    if (v && v.name) map[v.name] = String(v.value ?? '');
  }

  const missing = [];
  const text = input.replace(VAR_RE, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(map, name)) return map[name];
    if (!missing.includes(name)) missing.push(name);
    return match;
  });
  return { text, missing };
}

/** Resolve every field of a request form in one pass. */
export function resolveRequest(req, scopes) {
  const missing = new Set();
  const track = (value) => {
    const r = resolveVars(value, scopes);
    r.missing.forEach((m) => missing.add(m));
    return r.text;
  };
  const params = (req.params || [])
    .filter((p) => p.on !== false && p.k)
    .map((p) => ({ k: track(p.k), v: track(p.v || '') }));
  const headers = (req.headers || [])
    .filter((h) => h.on !== false && h.k)
    .map((h) => ({ k: track(h.k), v: track(h.v || '') }));
  return {
    url: track(req.url || ''),
    params,
    headers,
    body: track(req.body || ''),
    missing: [...missing],
  };
}
