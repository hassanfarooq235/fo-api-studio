/**
 * OData helpers: fetch /data/$metadata, list entity sets, inspect an entity
 * and generate URLs / request bodies from the metadata.
 *
 * The full $metadata document is large (several MB), so it is kept in memory
 * for the session and only the list of entity set names is persisted.
 */

import { httpSend } from './gateway.js';

const SETS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const memory = new Map(); // baseUrl -> {doc, sets, ts}

function all(doc, localName) {
  return Array.from(doc.getElementsByTagName('*')).filter((e) => e.localName === localName);
}

function entitySetNames(doc) {
  const names = new Set();
  for (const el of all(doc, 'EntitySet')) {
    const n = el.getAttribute('Name');
    if (n) names.add(n);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

async function readCache() {
  const data = await chrome.storage.local.get('metaCache');
  return data.metaCache || {};
}

async function writeCache(cache) {
  // keep the cache small: 10 newest environments
  const entries = Object.entries(cache).sort((a, b) => (b[1]?.ts || 0) - (a[1]?.ts || 0));
  await chrome.storage.local.set({ metaCache: Object.fromEntries(entries.slice(0, 10)) });
}

/** Entity set names for an environment, from the local cache if available. */
export async function cachedSets(env) {
  const key = env?.baseUrl;
  if (!key) return null;
  if (memory.has(key)) return memory.get(key).sets;
  const cache = await readCache();
  const entry = cache[key];
  if (entry && Date.now() - (entry.ts || 0) < SETS_TTL_MS) return entry.sets;
  return null;
}

/** Fetch and parse /data/$metadata (auth-aware, goes through the background). */
export async function loadMetadata(env, { refresh = false } = {}) {
  const key = env?.baseUrl;
  if (!key) throw new Error('Select an environment first.');

  if (!refresh && memory.has(key)) return memory.get(key);

  const res = await httpSend({
    url: `${key.replace(/\/+$/, '')}/data/$metadata`,
    method: 'GET',
    headers: { Accept: 'application/xml' },
    timeoutMs: 90000,
    auth: { envId: env.id },
  });
  if (!res.ok) throw new Error(res.error.message);

  const r = res.response;
  if (r.status >= 400) {
    throw new Error(
      `$metadata returned HTTP ${r.status} ${r.statusText}. ${truncate(r.bodyText, 300)}`,
    );
  }

  const doc = new DOMParser().parseFromString(r.bodyText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('The metadata document is not valid XML.');
  }

  const sets = entitySetNames(doc);
  if (!sets.length) throw new Error('No public entity sets were found in $metadata.');

  const entry = { doc, sets, ts: Date.now() };
  memory.set(key, entry);

  const cache = await readCache();
  cache[key] = { ts: entry.ts, sets };
  await writeCache(cache);

  return entry;
}

function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

/** Details (keys + properties) for one entity set. */
export function entityDetail(doc, setName) {
  if (!doc || !setName) return null;
  const els = Array.from(doc.getElementsByTagName('*'));
  const setEl = els.find((e) => e.localName === 'EntitySet' && e.getAttribute('Name') === setName);
  if (!setEl) return null;

  // CSDL: <EntitySet Name="X" EntityType="Ns.X"/> (older/other tools may emit Type=)
  const typeAttr = setEl.getAttribute('EntityType') || setEl.getAttribute('Type') || '';
  const typeName = String(typeAttr).split('.').pop();
  const typeEl = els.find((e) => e.localName === 'EntityType' && e.getAttribute('Name') === typeName);
  if (!typeEl) return null;

  const keyEl = Array.from(typeEl.children).find((c) => c.localName === 'Key');
  const keys = keyEl
    ? Array.from(keyEl.children)
        .filter((c) => c.localName === 'PropertyRef')
        .map((c) => c.getAttribute('Name'))
        .filter(Boolean)
    : [];

  const properties = Array.from(typeEl.children)
    .filter((c) => c.localName === 'Property')
    .map((c) => ({
      name: c.getAttribute('Name'),
      type: String(c.getAttribute('Type') || '').split('.').pop(),
      nullable: c.getAttribute('Nullable') !== 'false',
    }))
    .filter((p) => p.name);

  const nav = Array.from(typeEl.children)
    .filter((c) => c.localName === 'NavigationProperty')
    .map((c) => c.getAttribute('Name'))
    .filter(Boolean);

  return { setName, typeName, keys, properties, nav };
}

/** Quick GET URL for a collection, using the built-in {{$baseUrl}} variable. */
export function collectionUrl(setName) {
  return `{{$baseUrl}}/data/${setName}?cross-company=true&$top=25`;
}

function needsQuotes(type) {
  return !/^(Edm\.)?(Int|UInt|Decimal|Double|Single|Boolean|Byte)/i.test(String(type || ''));
}

/** Build an entity-key URL: DataEntity(Pk1='x', Pk2=2) */
export function keyUrl(setName, detail, values) {
  const parts = [];
  for (const key of detail.keys) {
    const raw = values[key];
    const prop = detail.properties.find((p) => p.name === key);
    if (raw === undefined || raw === null || raw === '') continue;
    const quoted = needsQuotes(prop?.type);
    parts.push(`${key}=${quoted ? `'${String(raw).replace(/'/g, "''")}'` : raw}`);
  }
  if (!parts.length) return `{{$baseUrl}}/data/${setName}`;
  return `{{$baseUrl}}/data/${setName}(${parts.join(', ')})`;
}

function placeholderFor(type) {
  const t = String(type || '');
  if (/Boolean/i.test(t)) return false;
  if (/^(Edm\.)?(Int|UInt|Byte|Short|Long)/i.test(t)) return 0;
  if (/Decimal|Double|Single|Real/i.test(t)) return 0;
  if (/DateTime/i.test(t)) return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return '';
}

/**
 * JSON body for POST/PATCH.
 * @param {object} detail entityDetail()
 * @param {'create'|'update'} mode
 */
export function entityBody(detail, mode) {
  const out = {};
  for (const p of detail.properties) {
    if (detail.nav.includes(p.name)) continue; // navigation properties are not scalar payload

    if (mode === 'create') {
      // Never send values the server generates itself.
      const isRecId = /^RecId$/i.test(p.name);
      const isRowId = /RowId$/i.test(p.name);
      const isGuidKey = detail.keys.includes(p.name) && p.type === 'Guid';
      if (isRecId || isRowId || isGuidKey) continue;
    }
    out[p.name] = placeholderFor(p.type);
  }
  return JSON.stringify(out, null, 2);
}

/* ================================================================== *
 * Actions and functions
 *
 * $metadata declares them as <Action>/<Function>. A bound operation's first
 * Parameter names the binding type, e.g.
 *   <Action Name="CreditLimitIncrease" IsBound="true">
 *     <Parameter Name="bindingParameter" Type="Contoso.CustomersV3"/>
 *     <Parameter Name="amount" Type="Edm.Decimal"/>
 *   </Action>
 * OData v4 says actions POST a JSON body of parameters while functions take
 * theirs in the URL: Set(key)/Func(amount=10).
 * ================================================================== */

/** The metadata document currently in memory for an environment (no I/O). */
export function cachedDoc(env) {
  const entry = env?.baseUrl ? memory.get(env.baseUrl) : null;
  return entry?.doc || null;
}

const operationsCache = new WeakMap(); // doc -> operations[]

function stripCollection(type) {
  const m = /^Collection\((.*)\)$/s.exec(String(type || ''));
  return (m ? m[1] : String(type || '')).split('.').pop();
}

function computeOperations(doc) {
  const out = [];
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (el.localName !== 'Action' && el.localName !== 'Function') continue;
    const name = el.getAttribute('Name');
    if (!name) continue;

    const params = Array.from(el.children)
      .filter((c) => c.localName === 'Parameter')
      .map((c) => ({
        name: c.getAttribute('Name'),
        type: String(c.getAttribute('Type') || ''),
        optional: String(c.getAttribute('IsOptional')).toLowerCase() === 'true',
      }))
      .filter((p) => p.name);

    const isBound = String(el.getAttribute('IsBound')).toLowerCase() === 'true';
    const ret = Array.from(el.children).find((c) => c.localName === 'ReturnType');
    out.push({
      name,
      kind: el.localName === 'Action' ? 'action' : 'function',
      isBound,
      bindingType: isBound && params.length ? params[0].type : '',
      // the binding parameter is supplied by the URL, never by the caller
      params: isBound ? params.slice(1) : params,
      returns: ret ? String(ret.getAttribute('Type') || '') : '',
    });
  }
  // stable, alphabetical; bound operations keep their order among themselves
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

/** Every Action/Function in the document (memoised per document). */
export function operations(doc) {
  if (!doc || typeof doc.getElementsByTagName !== 'function') return [];
  if (operationsCache.has(doc)) return operationsCache.get(doc);
  const list = computeOperations(doc);
  operationsCache.set(doc, list);
  return list;
}

/**
 * Operations for one entity set: those bound to its entity type, plus every
 * unbound one (which is callable on the service root).
 * @returns {{bound: Array, unbound: Array}}
 */
export function operationsForSet(doc, setName) {
  const ops = operations(doc);
  const unbound = ops.filter((o) => !o.isBound);
  if (!doc || !setName) return { bound: [], unbound };

  const els = Array.from(doc.getElementsByTagName('*'));
  const setEl = els.find((e) => e.localName === 'EntitySet' && e.getAttribute('Name') === setName);
  if (!setEl) return { bound: [], unbound };

  const typeName = String(setEl.getAttribute('EntityType') || setEl.getAttribute('Type') || '')
    .split('.')
    .pop();
  const bound = typeName ? ops.filter((o) => o.isBound && stripCollection(o.bindingType) === typeName) : [];
  return { bound, unbound };
}

/** URL for an action (POST) or function (GET, parameters in parentheses). */
export function operationUrl(op, { setName = '', detail = null, keyValues = {}, paramValues = {} } = {}) {
  const segments = [];

  if (op.isBound) {
    if (!detail) throw new Error('Choose the entity set this operation is bound to.');
    const keySegment = keyUrl(setName, detail, keyValues).replace(/^\{\{\$baseUrl\}\}\/data\//, '');
    if (!keySegment.includes('(')) {
      throw new Error('This operation needs the entity key — fill in at least one key value.');
    }
    segments.push(keySegment);
  }
  segments.push(op.name);

  let url = `{{$baseUrl}}/data/${segments.join('/')}`;

  if (op.kind === 'function' && op.params.length) {
    const args = [];
    for (const p of op.params) {
      const raw = paramValues[p.name];
      if (raw === undefined || raw === null || raw === '') continue; // optional left blank
      const quoted = needsQuotes(p.type);
      args.push(`${p.name}=${quoted ? `'${String(raw).replace(/'/g, "''")}'` : raw}`);
    }
    if (args.length) url += `(${args.join(',')})`;
  }
  return url;
}

/** JSON body for an action: one placeholder per parameter (binding excluded). */
export function operationBody(op) {
  const out = {};
  for (const p of op.params) out[p.name] = placeholderFor(p.type);
  return JSON.stringify(out, null, 2);
}

/** OData parameter suggestions for the Params tab. */
export const ODATA_PARAM_HINTS = [
  '$filter',
  '$select',
  '$expand',
  '$orderby',
  '$top',
  '$skip',
  'cross-company',
  'odata.maxpagesize',
];
