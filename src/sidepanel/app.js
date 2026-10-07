/**
 * F&O API Studio — side panel controller.
 *
 * Owns: navigation, the request builder, environments, collections, history,
 * settings and the send pipeline. All network/auth work happens in the
 * background process (see ../background).
 */

import { STORAGE, DEFAULT_SETTINGS, APP, AUTH_MODES } from '../shared/constants.js';
import { resolveRequest } from '../shared/variables.js';
import { originOf } from '../shared/url.js';
import { dropAutoHeaders, injectAutoHeaders, methodSendsBody } from './modules/sendrules.js';
import {
  $,
  $$,
  toast,
  renderKv,
  rowsToObject,
  escapeHtml,
  fmtTime,
  fmtMs,
  confirmDialog,
} from './modules/ui.js';
import { httpSend, envs as envApi, auth as authApi } from './modules/gateway.js';
import * as odata from './modules/odata.js';
import * as ws from './modules/webservice.js';
import * as response from './modules/response.js';
import { parseCurl } from './modules/curl.js';

const MODE_LABEL = {
  [AUTH_MODES.SESSION]: 'Browser session',
  [AUTH_MODES.INTERACTIVE]: 'Interactive sign-in (PKCE)',
  [AUTH_MODES.CLIENT]: 'Application (client secret)',
  [AUTH_MODES.MANUAL]: 'Bearer token',
};

const state = {
  pane: 'build',
  kind: 'odata',
  envs: [],
  activeEnvId: null,
  globals: [],
  collections: [],
  history: [],
  settings: { ...DEFAULT_SETTINGS },
  envFormVars: [],
  editingEnvId: null,
  contract: null,
  contractKey: '',
  sending: false,
  req: { params: [], headers: [], body: '', bodyMode: 'none' },
};

/**
 * One-shot instructions for the next send() — set just before calling it.
 * append: merge the response's rows into the ones already displayed.
 * dropParams: send the URL exactly as-is (used by OData continuation links,
 *   which already carry the full query string; re-adding ours would duplicate
 *   $top / $skiptoken and break paging).
 */
let sendPlan = null;

/* ================================================================== *
 * Boot
 * ================================================================== */

async function init() {
  response.configure({
    body: $('#resBody'),
    meta: $('#resMeta'),
    grantAccess: requestOriginAccess,
    nextPage: loadNextPage,
    rowAction: buildRequestFromRow,
  });

  await loadStored();
  await loadEnvs();

  wireNav();
  wireKindTabs();
  wireRequestTabs();
  wireResponseTabs();
  wireRequestForm();
  wireEnvPane();
  wireCollectionsPane();
  wireHistoryPane();
  wireSettingsPane();

  wireShortcuts();
  await restoreDraft();
  renderAll();
}

async function loadStored() {
  const data = await chrome.storage.local.get([
    STORAGE.GLOBALS,
    STORAGE.COLLECTIONS,
    STORAGE.HISTORY,
    STORAGE.SETTINGS,
  ]);
  state.globals = data[STORAGE.GLOBALS] || [];
  state.collections = data[STORAGE.COLLECTIONS] || [];
  state.history = data[STORAGE.HISTORY] || [];
  state.settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE.SETTINGS] || {}) };
}

const persist = {
  globals: () => chrome.storage.local.set({ [STORAGE.GLOBALS]: state.globals }),
  collections: () => chrome.storage.local.set({ [STORAGE.COLLECTIONS]: state.collections }),
  history: () => chrome.storage.local.set({ [STORAGE.HISTORY]: state.history }),
  settings: () => chrome.storage.local.set({ [STORAGE.SETTINGS]: state.settings }),
};

/* ================================================================== *
 * Draft — the in-progress request, restored the next time the panel opens.
 *
 * Header values that look like credentials are stripped before writing, so a
 * pasted bearer token never lands in panel-owned storage (tokens belong to the
 * background, in the environment's Auth tab).
 * ================================================================== */

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|api-key|x-csrf-token)$/i;

function draftIsEmpty(d) {
  return (
    !d.url &&
    !d.body &&
    !(d.params || []).length &&
    !(d.headers || []).length &&
    !d.entity &&
    !d.service?.group &&
    !d.service?.service
  );
}

async function saveDraft() {
  if (!draftReady) return; // boot not finished — an empty form would erase the draft
  const draft = snapshot('draft');
  draft.headers = (draft.headers || []).map((h) =>
    SENSITIVE_HEADER.test(String(h.k || '').trim()) ? { ...h, v: '' } : h,
  );
  try {
    if (draftIsEmpty(draft)) await chrome.storage.local.remove(STORAGE.DRAFT);
    else await chrome.storage.local.set({ [STORAGE.DRAFT]: draft });
  } catch {
    // Storage can be full or blocked; losing a draft is not worth an error.
  }
}

let draftTimer = null;
/**
 * False until restoreDraft() has finished: at boot the DOM is still empty for
 * a moment, and saving that emptiness would delete the very draft we are about
 * to restore (a window blur is enough to trigger a save).
 */
let draftReady = false;

function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = null;
    saveDraft();
  }, 700);
}

async function restoreDraft() {
  let data = null;
  try {
    data = await chrome.storage.local.get(STORAGE.DRAFT);
  } catch {
    data = null;
  }
  try {
    const draft = data?.[STORAGE.DRAFT];
    if (!draft || typeof draft !== 'object' || draftIsEmpty(draft)) return;
    applySnapshot(draft, { silent: true });
    toast('Restored your last request.');
  } finally {
    draftReady = true;
  }
}

async function loadEnvs() {
  const res = await envApi.list();
  if (!res.ok) {
    toast(res.error?.message || 'Could not load environments.');
    return;
  }
  state.envs = res.envs || [];
  state.activeEnvId = res.activeEnvId || state.envs[0]?.id || null;
  try {
    await fillEntityListFromCache(); // convenience only — must never block a caller
  } catch {
    /* metadata cache unreadable: the entity list simply stays empty */
  }
}

function activeEnv() {
  return state.envs.find((e) => e.id === state.activeEnvId) || state.envs[0] || null;
}

/* ================================================================== *
 * Navigation / tabs
 * ================================================================== */

function wireNav() {
  $('#paneNav').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pane]');
    if (btn) openPane(btn.dataset.pane);
  });
  $('#btnRefresh').addEventListener('click', async () => {
    await loadEnvs();
    renderEnvSelect();
    toast('Environments reloaded.');
  });
}

function openPane(name) {
  state.pane = name;
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.pane === name));
  $$('.pane').forEach((p) => p.classList.toggle('active', p.id === `pane-${name}`));
  if (name === 'collections') renderCollections();
  if (name === 'history') renderHistory();
}

function wireKindTabs() {
  $('#kindTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kind]');
    if (!btn) return;
    state.kind = btn.dataset.kind;
    renderKind();
  });
}

function renderKind() {
  $$('#kindTabs .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.kind === state.kind));
  ['odata', 'service', 'raw'].forEach((k) => {
    $(`#kind-${k}`).classList.toggle('hidden', k !== state.kind);
  });

  // A generated SOAP envelope injects Content-Type / SOAPAction. They belong
  // to that request type only — an OData PATCH must not still be announcing
  // text/xml — so they go as soon as we leave the service builder.
  if (state.kind !== 'service') dropAutoSoapHeaders();

  const url = $('#url');
  if (state.kind === 'odata') {
    url.placeholder = '{{$baseUrl}}/data/CustomersV3';
    if (!url.value) $('#method').value = 'GET';
  } else if (state.kind === 'service') {
    url.placeholder = '{{$baseUrl}}/api/services/MyGroup/MyService/MyOperation';
    if (!url.value || $('#method').value === 'GET') $('#method').value = 'POST';
  } else {
    url.placeholder = 'https://… or {{$baseUrl}}/api/data/…';
  }
  renderParamHints();
}

/** Drop panel-injected SOAP headers the user has not edited. */
function dropAutoSoapHeaders() {
  const { headers, changed } = dropAutoHeaders(state.req.headers, state.req.autoSoap);
  state.req.autoSoap = [];
  if (!changed) return;
  state.req.headers = headers;
  renderAllKv();
}

function wireRequestTabs() {
  $('#reqTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-req]');
    if (!btn) return;
    $$('#reqTabs .seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
    $$('.reqpane').forEach((p) => p.classList.toggle('active', p.id === `req-${btn.dataset.req}`));
  });
}

function wireResponseTabs() {
  $('#resTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-res]');
    if (!btn) return;
    $$('#resTabs .seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
    response.setView(btn.dataset.res);
  });
  $('#btnCopyRes').addEventListener('click', async () => {
    const text = response.currentJson() || response.currentText();
    if (!text) return toast('Nothing to copy yet.');
    await navigator.clipboard.writeText(text);
    toast('Response copied.');
  });
}

/* ================================================================== *
 * Request form
 * ================================================================== */

function wireShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return;
    if (state.pane !== 'build') return; // never fire while editing an environment
    e.preventDefault();
    send();
  });
}

function wireRequestForm() {
  // key/value editors
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add-kv]');
    if (!btn) return;
    const id = btn.dataset.addKv;
    const map = {
      kvParams: state.req.params,
      kvHeaders: state.req.headers,
      kvEnvVars: state.envFormVars,
      kvGlobals: state.globals,
    };
    const rows = map[id];
    if (!rows) return;
    rows.push({ k: '', v: '', on: true });
    renderAllKv();
    const container = $(`#${id}`);
    container.lastElementChild?.querySelector('.kv-key')?.focus();
    if (id === 'kvGlobals') persist.globals();
  });

  $('#method').addEventListener('change', () => {});
  $('#url').addEventListener('input', () => hidePermChip());

  $('#bodyMode').addEventListener('change', () => {
    state.req.bodyMode = $('#bodyMode').value;
    $('#body').disabled = state.req.bodyMode === 'none';
  });

  $('#btnFormatBody').addEventListener('click', () => {
    const el = $('#body');
    try {
      el.value = JSON.stringify(JSON.parse(el.value), null, 2);
      state.req.body = el.value;
      toast('Formatted.');
    } catch {
      toast('Body is not valid JSON.');
    }
  });

  $('#btnClearBody').addEventListener('click', () => {
    $('#body').value = '';
    state.req.body = '';
  });

  $('#body').addEventListener('input', () => {
    state.req.body = $('#body').value;
  });

  $('#btnSend').addEventListener('click', send);
  $('#btnCurl').addEventListener('click', copyCurl);
  $('#btnSaveReq').addEventListener('click', openSaveBox);
  $('#btnCurlImportOpen').addEventListener('click', openCurlBox);
  $('#btnCurlCancel').addEventListener('click', () => $('#curlBox').classList.add('hidden'));
  $('#btnCurlImport').addEventListener('click', importCurl);

  // Keep the in-progress request saved (debounced); blur catches changes that
  // were made programmatically, e.g. a URL built by the OData helpers.
  const buildPane = $('#pane-build');
  buildPane.addEventListener('input', scheduleDraftSave);
  buildPane.addEventListener('change', scheduleDraftSave);
  window.addEventListener('blur', saveDraft);

  $('#paramHints').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-param]');
    if (!chip) return;
    state.req.params.push({ k: chip.dataset.param, v: '', on: true });
    renderAllKv();
    switchRequestTab('params');
    $('#kvParams').lastElementChild?.querySelector('.kv-key')?.focus();
  });

  // Auth tab actions
  $('#btnSignIn').addEventListener('click', () => runAuth('signin'));
  $('#btnGetToken').addEventListener('click', () => runAuth('token'));
  $('#btnRevealToken').addEventListener('click', () => runAuth('reveal'));
  $('#btnInspect').addEventListener('click', () => runAuth('inspect'));

  // OData helpers
  $('#odLoadMeta').addEventListener('click', loadMeta);
  $('#odEntity').addEventListener('change', () => {
    $('#odKeyBox').classList.add('hidden');
    fillOperationList();
  });
  $('#odMakeGet').addEventListener('click', makeCollectionUrl);
  $('#odMakeKey').addEventListener('click', makeKeyUrl);
  $('#odMakeBody').addEventListener('click', makeEntityBody);
  $('#odMakeOp').addEventListener('click', makeOperationCall);

  // Custom service helpers
  $('#svFetch').addEventListener('click', fetchServiceContract);
  $('#svOperation').addEventListener('change', updateServiceUrl);
  $('#svMakeBody').addEventListener('click', makeServiceBody);
  $('#svMakeSoap').addEventListener('click', makeSoapEnvelope);
}

function switchRequestTab(name) {
  $$('#reqTabs .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.req === name));
  $$('.reqpane').forEach((p) => p.classList.toggle('active', p.id === `req-${name}`));
}

function renderParamHints() {
  const hints = state.kind === 'odata' ? odata.ODATA_PARAM_HINTS : [];
  $('#paramHints').innerHTML = hints.map((h) => `<button class="chip-btn" type="button" data-param="${escapeHtml(h)}">${escapeHtml(h)}</button>`).join('');
}

function renderAllKv() {
  renderKv($('#kvParams'), state.req.params, (i) => {
    state.req.params.splice(i, 1);
    renderAllKv();
  });
  renderKv($('#kvHeaders'), state.req.headers, (i) => {
    state.req.headers.splice(i, 1);
    renderAllKv();
  });
  renderKv($('#kvEnvVars'), state.envFormVars, (i) => {
    state.envFormVars.splice(i, 1);
    renderAllKv();
  });
  renderKv($('#kvGlobals'), state.globals, (i) => {
    state.globals.splice(i, 1);
    renderAllKv();
    persist.globals();
  });
  // persist edited globals values (input events mutate rows in place)
  const globalsContainer = $('#kvGlobals');
  globalsContainer.onchange = () => persist.globals();
}

/* ================================================================== *
 * Send pipeline
 * ================================================================== */

function appendParams(url, params) {
  if (!params.length) return url;
  // Keep "$" unescaped so OData query options read naturally ($filter=...).
  const enc = (s) => encodeURIComponent(s).replace(/%24/g, '$');
  const qs = params.map((p) => `${enc(p.k)}=${enc(p.v ?? '')}`).join('&');
  return url + (url.includes('?') ? '&' : '?') + qs;
}

function buildResolved() {
  const env = activeEnv();
  const scopes = { env, globals: state.globals };
  return resolveRequest(
    { url: $('#url').value.trim(), params: state.req.params, headers: state.req.headers, body: state.req.body },
    scopes,
  );
}

function applyDefaultHeaders(headers, method, finalUrl) {
  const has = (name) => Object.keys(headers).some((h) => h.toLowerCase() === name.toLowerCase());
  if (!has('accept')) headers.Accept = 'application/json, application/xml;q=0.9, */*;q=0.8';

  // A GET/HEAD sends no body, so it must not announce a Content-Type either.
  const body = methodSendsBody(method) ? state.req.body : '';
  if (body && !has('content-type')) {
    headers['Content-Type'] =
      state.req.bodyMode === 'xml' ? 'application/xml; charset=utf-8' : 'application/json; charset=utf-8';
  }

  if (state.kind === 'odata') {
    if (!has('odata-version')) headers['OData-Version'] = '4.0';
    if (method === 'PATCH' && !has('if-match')) headers['If-Match'] = '*';
    if (method === 'DELETE' && !has('if-match')) headers['If-Match'] = '*';
    if (method === 'PUT' && !has('if-match')) headers['If-Match'] = '*';
    if (method === 'POST' && !has('prefer')) headers.Prefer = 'return=representation';
  }

  if (state.kind === 'service' && state.req.bodyMode === 'xml') {
    const op = currentOperation();
    if (op && op.soapAction !== null && op.soapAction !== undefined && !has('soapaction')) {
      headers.SOAPAction = `"${op.soapAction}"`;
    }
  }
  return headers;
}

function currentOperation() {
  if (!state.contract) return null;
  const name = $('#svOperation').value;
  return state.contract.operations.find((o) => o.name === name) || null;
}

async function ensureOriginPermission(url) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return true; // let the transport layer report the problem
  }
  const pattern = `${origin}/*`;
  let has = false;
  try {
    has = await chrome.permissions.contains({ origins: [pattern] });
  } catch {
    has = false;
  }
  if (has) {
    hidePermChip();
    return true;
  }
  showPermChip(origin);
  return false;
}

function showPermChip(origin) {
  const chip = $('#permChip');
  chip.textContent = `Grant access to ${origin.replace(/^https?:\/\//, '')}`;
  chip.dataset.origin = origin;
  chip.classList.remove('hidden');
}

function hidePermChip() {
  $('#permChip').classList.add('hidden');
}

async function requestOriginAccess(origin) {
  if (!origin) return false;
  try {
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (granted) hidePermChip();
    return granted;
  } catch {
    return false;
  }
}

async function send() {
  if (state.sending) return;
  // Consumed here so an early return below cannot leak it into a later send.
  const plan = sendPlan || {};
  sendPlan = null;
  scheduleDraftSave(); // capture exactly what is about to be sent

  const env = activeEnv();
  if (!env) {
    toast('Create an environment first.');
    openPane('envs');
    return;
  }

  const resolved = buildResolved();
  if (!resolved.url) {
    toast('Enter a request URL.');
    return;
  }

  const method = $('#method').value;
  const finalUrl = plan.dropParams ? resolved.url : appendParams(resolved.url, resolved.params);
  const headers = applyDefaultHeaders(rowsToObject(resolved.headers), method, finalUrl);

  const notes = [];
  if (resolved.missing.length) notes.push(`missing: ${resolved.missing.join(', ')}`);
  if (state.req.body && state.req.bodyMode !== 'none' && !methodSendsBody(method)) {
    notes.push(`${method} carries no body — it was not sent`);
  }
  setSendHint(notes.length ? `⚠ ${notes.join(' · ')}` : '');

  if (!(await ensureOriginPermission(finalUrl))) {
    setSendHint('Access needed — click the badge in the toolbar, then Send again.');
    return;
  }

  const spec = {
    url: finalUrl,
    method,
    headers,
    body: state.req.bodyMode !== 'none' && methodSendsBody(method) ? resolved.body : null,
    timeoutMs: state.settings.timeoutMs,
    auth: { envId: env.id },
  };

  state.sending = true;
  $('#btnSend').disabled = true;
  $('#btnSend').textContent = 'Sending…';

  const res = await httpSend(spec);

  state.sending = false;
  $('#btnSend').disabled = false;
  $('#btnSend').textContent = 'Send';

  response.setResponse(res, { append: Boolean(plan.append) });
  if (res.ok) pushHistory(res.response, spec);
}

/**
 * Follow an OData continuation link (@odata.nextLink) and add the next page
 * to the table already on screen.
 */
async function loadNextPage() {
  const link = response.nextPageUrl();
  if (!link) return toast('This response has no next page.');
  if (state.sending) return;

  $('#method').value = 'GET';
  $('#url').value = link;
  hidePermChip();
  sendPlan = { append: true, dropParams: true };
  await send();
}

function setSendHint(text) {
  $('#sendHint').textContent = text;
}

/**
 * Record → request: rebuild an editable request from a row of the Table view.
 * "edit" produces a PATCH keyed on the entity's key columns (plus the row's
 * ETag, when the server sent one); "delete" produces a DELETE for the same key.
 */
async function buildRequestFromRow(action, row) {
  if (state.sending) return;
  const set = selectedEntity();
  if (!set) return toast('Pick the entity set on the OData tab so its key can be resolved.');

  let meta;
  try {
    meta = await ensureMetadata();
  } catch {
    return;
  }
  const detail = odata.entityDetail(meta.doc, set);
  if (!detail) return toast(`Entity “${set}” was not found in $metadata.`);
  if (!detail.keys.length) return toast('This entity has no key properties.');

  const keyValues = {};
  for (const k of detail.keys) {
    if (row?.[k] === undefined || row[k] === null) {
      return toast(`This row has no “${k}” column — reload $metadata, then try again.`);
    }
    keyValues[k] = row[k];
  }

  state.kind = 'odata';
  $('#method').value = action === 'delete' ? 'DELETE' : 'PATCH';
  $('#url').value = odata.keyUrl(set, detail, keyValues);

  // Optimistic concurrency: prefer the row's real ETag over a blind "*".
  const etag = row['@odata.etag'];
  const existing = state.req.headers.find((h) => String(h.k || '').toLowerCase() === 'if-match');
  if (etag) {
    if (existing) existing.v = etag;
    else state.req.headers.push({ k: 'If-Match', v: etag, on: true });
  }

  if (action === 'delete') {
    state.req.body = '';
    state.req.bodyMode = 'none';
  } else {
    const out = {};
    for (const p of detail.properties) {
      if (detail.nav.includes(p.name)) continue; // navigation is not a scalar field
      if (!(p.name in row)) continue;
      const v = row[p.name];
      if (v !== null && typeof v === 'object') continue;
      out[p.name] = v;
    }
    state.req.body = JSON.stringify(out, null, 2);
    state.req.bodyMode = 'json';
  }

  $('#body').value = state.req.body;
  $('#bodyMode').value = state.req.bodyMode;
  hidePermChip();
  renderKind();
  renderAllKv();
  switchRequestTab(action === 'delete' ? 'headers' : 'body');
  scheduleDraftSave();
  toast(action === 'delete' ? 'DELETE built — check the URL, then Send.' : 'PATCH built from that row.');
}

function pushHistory(responseObj, spec) {
  state.history.unshift({
    ts: Date.now(),
    status: responseObj.status,
    timeMs: responseObj.timeMs,
    req: snapshot(suggestName()),
    finalUrl: spec.url,
  });
  state.history = state.history.slice(0, state.settings.maxHistory);
  persist.history();
}

/* ---- cURL import ---- */

function openCurlBox() {
  const err = $('#curlErr');
  err.textContent = '';
  err.classList.remove('err');
  $('#curlBox').classList.remove('hidden');
  $('#curlText').focus();
}

function importCurl() {
  const parsed = parseCurl($('#curlText').value);
  const err = $('#curlErr');
  if (parsed.error) {
    err.textContent = parsed.error;
    err.classList.add('err');
    return;
  }
  applyCurl(parsed);
  $('#curlBox').classList.add('hidden');
  toast(parsed.notes.length ? `Imported — ${parsed.notes[0]}` : 'cURL imported.');
}

function applyCurl(p) {
  $('#method').value = p.method;
  $('#url').value = p.url;
  state.req.params = p.params;
  state.req.headers = p.headers;
  state.req.body = p.body;
  state.req.bodyMode = p.bodyMode;
  $('#body').value = p.body;
  $('#bodyMode').value = p.bodyMode;
  $('#body').disabled = p.bodyMode === 'none';

  // A /data/ endpoint is an OData call — switch so the right defaults apply.
  if (/\/data(\/|$|\?)/.test(p.url)) state.kind = 'odata';

  hidePermChip();
  renderKind();
  renderAllKv();
  switchRequestTab(p.body ? 'body' : p.params.length ? 'params' : 'headers');
  scheduleDraftSave();
}

async function copyCurl() {
  const resolved = buildResolved();
  if (!resolved.url) return toast('Enter a request URL first.');

  const method = $('#method').value;
  const finalUrl = appendParams(resolved.url, resolved.params);
  const headers = applyDefaultHeaders(rowsToObject(resolved.headers), method, finalUrl);

  // Never copy a real token to the clipboard.
  if (headers.Authorization) headers.Authorization = 'Bearer <access_token>';

  const parts = [`curl -X ${method} '${finalUrl.replace(/'/g, "'\\''")}'`];
  for (const [k, v] of Object.entries(headers)) {
    parts.push(`  -H '${k}: ${String(v).replace(/'/g, "'\\''")}'`);
  }
  const body = state.req.bodyMode !== 'none' && methodSendsBody(method) ? resolved.body : '';
  if (body) {
    parts.push(`  --data-raw '${body.replace(/'/g, "'\\''")}'`);
  }

  await navigator.clipboard.writeText(parts.join(' \\\n'));
  toast('cURL copied (token replaced with a placeholder).');
}

/* ================================================================== *
 * Auth tab
 * ================================================================== */

async function runAuth(action) {
  const env = activeEnv();
  if (!env) return toast('Create an environment first.');
  const out = $('#authOut');

  if (action === 'signin') {
    out.textContent = 'Opening the sign-in window…';
    const res = await authApi.signIn(env.id);
    out.textContent = res.ok ? `Signed in.\n${JSON.stringify(res.status, null, 2)}` : `✗ ${res.error.message}`;
  } else if (action === 'token') {
    out.textContent = 'Fetching a token…';
    const res = await authApi.token(env.id, { force: true });
    out.textContent = res.ok ? `✓ ${res.note}\n${JSON.stringify(res.status, null, 2)}` : `✗ ${res.error.message}`;
  } else if (action === 'reveal') {
    const res = await authApi.token(env.id, { reveal: true });
    out.textContent = res.ok
      ? `${res.token}\n\n⚠ Treat this token as a password — anyone with it can act as you.`
      : `✗ ${res.error.message}`;
  } else if (action === 'inspect') {
    const res = await authApi.inspect(env.id);
    if (!res.ok) return void (out.textContent = `✗ ${res.error.message}`);
    if (!res.claims) return void (out.textContent = res.note || 'No token to inspect.');
    const problems = res.problems?.length ? `\n\nProblems:\n- ${res.problems.join('\n- ')}` : '';
    out.textContent = `${JSON.stringify(res.claims, null, 2)}${problems}`;
  }
  renderAuthSummary();
}

function renderAuthSummary() {
  const env = activeEnv();
  const box = $('#authSummary');
  if (!env) {
    box.textContent = 'No environment selected.';
    return;
  }
  const mode = MODE_LABEL[env.auth?.mode] || env.auth?.mode;
  box.innerHTML = `
    <div class="li-title">${escapeHtml(env.name)}</div>
    <div class="hint">${escapeHtml(env.baseUrl)}</div>
    <div class="hint">${escapeHtml(mode)}${env.company ? ` · company <code>${escapeHtml(env.company)}</code>` : ''}</div>
    <div class="hint">Access tokens are requested and cached by the background process.</div>`;

  authApi.status(env.id).then((res) => {
    if (res.ok && res.status) {
      const note = document.createElement('div');
      note.className = `hint ${res.status.ready ? 'status-ok' : 'status-warn'}`;
      note.textContent = res.status.note || '';
      box.appendChild(note);
    }
  });
}

/* ================================================================== *
 * OData helpers
 * ================================================================== */

async function ensureMetadata() {
  const env = activeEnv();
  if (!env) {
    toast('Create an environment first.');
    openPane('envs');
    throw new Error('no environment');
  }
  return odata.loadMetadata(env);
}

async function fillEntityListFromCache() {
  const env = activeEnv();
  if (!env) return;
  const sets = await odata.cachedSets(env);
  if (sets) fillEntityList(sets);
  fillOperationList(); // only populated when $metadata is in memory this session
}

function fillEntityList(sets) {
  $('#odEntityList').innerHTML = sets.map((s) => `<option value="${escapeHtml(s)}"></option>`).join('');
  $('#odMetaInfo').textContent = `${sets.length} public entity sets available for this environment.`;
}

async function loadMeta() {
  const btn = $('#odLoadMeta');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  try {
    const meta = await ensureMetadata();
    fillEntityList(meta.sets);
    fillOperationList();
    toast(`Loaded ${meta.sets.length} entity sets.`);
  } catch (e) {
    if (e.message !== 'no environment') toast(e.message);
    $('#odMetaInfo').textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load';
  }
}

function selectedEntity() {
  return $('#odEntity').value.trim();
}

function makeCollectionUrl() {
  const set = selectedEntity();
  if (!set) return toast('Pick an entity set first (Load, then choose).');
  $('#method').value = 'GET';
  $('#url').value = odata.collectionUrl(set);
  hidePermChip();
  toast('GET URL built.');
}

/**
 * Render a form of inputs inside #odKeyBox, then hand the collected values to
 * onValues. Shared by "By key…" and by action/function calls.
 * @param {Array<{name: string, hint?: string}>} fields
 */
function showCallForm(fields, buttonLabel, onValues) {
  const box = $('#odKeyBox');
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="hint">${fields
      .map((f) => (f.hint ? `${escapeHtml(f.hint)}: ` : '') + `<code>${escapeHtml(f.name)}</code>`)
      .join(' ')}</div>
    ${fields
      .map(
        (f) =>
          `<label class="lbl">${escapeHtml(f.name)}<input data-field="${escapeHtml(f.name)}" spellcheck="false" autocomplete="off"></label>`,
      )
      .join('')}
    <div class="row"><button class="btn btn-sm btn-primary" id="odBuildCall" type="button">${escapeHtml(buttonLabel)}</button></div>`;

  $('#odBuildCall').addEventListener('click', () => {
    const values = {};
    box.querySelectorAll('[data-field]').forEach((input) => {
      values[input.dataset.field] = input.value.trim();
    });
    onValues(values);
  });
}

async function makeKeyUrl() {
  const set = selectedEntity();
  if (!set) return toast('Pick an entity set first.');
  let meta;
  try {
    meta = await ensureMetadata();
  } catch {
    return;
  }
  const detail = odata.entityDetail(meta.doc, set);
  if (!detail) return toast(`Entity “${set}” was not found in $metadata.`);
  if (!detail.keys.length) return toast('This entity has no key properties.');

  const fields = detail.keys.map((k) => ({
    name: k,
    hint: detail.properties.find((p) => p.name === k)?.type || 'key',
  }));
  showCallForm(fields, 'Build URL', (values) => {
    $('#method').value = 'GET';
    $('#url').value = odata.keyUrl(set, detail, values);
    hidePermChip();
    toast('Key URL built.');
  });
}

async function makeEntityBody() {
  const set = selectedEntity();
  if (!set) return toast('Pick an entity set first.');
  let meta;
  try {
    meta = await ensureMetadata();
  } catch {
    return;
  }
  const detail = odata.entityDetail(meta.doc, set);
  if (!detail) return toast(`Entity “${set}” was not found in $metadata.`);

  const method = $('#method').value;
  const mode = method === 'PATCH' || method === 'PUT' ? 'update' : 'create';
  state.req.body = odata.entityBody(detail, mode);
  state.req.bodyMode = 'json';
  $('#body').value = state.req.body;
  $('#bodyMode').value = 'json';
  switchRequestTab('body');
  toast(`Generated a “${mode}” body for ${set}.`);
}

/* ---------------------------------------------------- *
 * Actions & functions
 * ---------------------------------------------------- */

/** Refresh the action/function dropdown from the in-memory $metadata doc. */
function fillOperationList() {
  const select = $('#odOperation');
  const info = $('#odOpInfo');
  if (!select) return;

  const doc = odata.cachedDoc(activeEnv());
  if (!doc) {
    select.innerHTML = '<option value="">&mdash; Load metadata for actions &amp; functions &mdash;</option>';
    if (info) info.textContent = '';
    return;
  }

  const set = selectedEntity();
  const { bound, unbound } = odata.operationsForSet(doc, set);
  const label = (o, suffix) =>
    `<option value="${escapeHtml(`${o.kind}::${o.name}`)}">${escapeHtml(`${o.kind === 'action' ? 'Action' : 'Function'} · ${o.name}${suffix}`)}</option>`;

  select.innerHTML =
    '<option value="">&mdash; pick an action or function &mdash;</option>' +
    bound.map((o) => label(o, set ? ` (on ${set})` : '')).join('') +
    unbound.map((o) => label(o, ' (unbound)')).join('');

  if (info) {
    info.textContent = set
      ? `${bound.length} on ${set} · ${unbound.length} unbound · ${bound.length + unbound.length === 0 ? 'reload $metadata to refresh' : 'pick one, then Build call'}`
      : `${unbound.length} unbound operations · choose an entity set to see bound ones`;
  }
}

async function makeOperationCall() {
  const pick = $('#odOperation').value;
  if (!pick) return toast('Pick an action or function first — Load metadata, choose a set, then pick one.');

  let meta;
  try {
    meta = await ensureMetadata();
  } catch {
    return;
  }
  fillOperationList(); // doc may have just been fetched
  const select = $('#odOperation');
  if (select.value !== pick) select.value = pick;

  const set = selectedEntity();
  const { bound, unbound } = odata.operationsForSet(meta.doc, set);
  const [kind, name] = pick.split('::');
  const op = [...bound, ...unbound].find((o) => o.kind === kind && o.name === name);
  if (!op) return toast('That operation is no longer in $metadata — pick it again.');

  let detail = null;
  if (op.isBound) {
    if (!set) return toast('Choose the entity set this action is bound to.');
    detail = odata.entityDetail(meta.doc, set);
    if (!detail) return toast(`Entity “${set}” was not found in $metadata.`);
    if (!detail.keys.length) return toast('This entity has no key properties.');
  }

  // Bound operations need the entity key; functions take their parameters as
  // URL arguments; action parameters go into the JSON body instead.
  const fields = [];
  if (detail)
    for (const k of detail.keys)
      fields.push({ name: k, hint: detail.properties.find((p) => p.name === k)?.type || 'key' });
  if (op.kind === 'function') for (const p of op.params) fields.push({ name: p.name, hint: p.type });

  const build = (values) => {
    const keyValues = {};
    const paramValues = {};
    const seen = new Set();
    for (const f of fields) {
      if (seen.has(f.name)) continue;
      seen.add(f.name);
      if (detail && detail.keys.includes(f.name)) keyValues[f.name] = values[f.name];
      else paramValues[f.name] = values[f.name];
    }

    let url;
    try {
      url = odata.operationUrl(op, { setName: set, detail, keyValues, paramValues });
    } catch (e) {
      return toast(e.message);
    }

    const method = op.kind === 'action' ? 'POST' : 'GET';
    $('#method').value = method;
    $('#url').value = url;
    hidePermChip();

    if (method === 'POST') {
      state.req.body = odata.operationBody(op);
      state.req.bodyMode = 'json';
      $('#body').value = state.req.body;
      $('#bodyMode').value = 'json';
      switchRequestTab('body');
    }
    toast(`${op.kind === 'action' ? 'Action' : 'Function'} call built — ${method} ${name}.`);
  };

  if (!fields.length) return build({});
  showCallForm(fields, 'Build call', build);
}

/* ================================================================== *
 * Custom service helpers
 * ================================================================== */

async function fetchServiceContract() {
  const env = activeEnv();
  if (!env) return toast('Create an environment first.');
  const name = $('#svService').value.trim();
  if (!name) return toast('Enter the service name first.');

  const btn = $('#svFetch');
  btn.disabled = true;
  btn.textContent = 'Fetching…';
  try {
    state.contract = await ws.fetchContract(env, name);
    state.contractKey = `${env.id}|${name}`;
    const select = $('#svOperation');
    select.innerHTML =
      `<option value="">— choose an operation —</option>` +
      state.contract.operations
        .map((o) => `<option value="${escapeHtml(o.name)}">${escapeHtml(o.name)}</option>`)
        .join('');
    $('#svInfo').textContent =
      `Service “${state.contract.service || name}” · ${state.contract.operations.length} operations` +
      (state.contract.targetNs ? ` · ns ${state.contract.targetNs}` : '');
    toast('Contract loaded.');
    updateServiceUrl();
  } catch (e) {
    $('#svInfo').textContent = e.message;
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Fetch WSDL';
  }
}

function updateServiceUrl() {
  const group = $('#svGroup').value.trim();
  const service = $('#svService').value.trim();
  const operation = $('#svOperation').value;
  if (group && service && operation) {
    $('#url').value = `{{$baseUrl}}/api/services/${group}/${service}/${operation}`;
    $('#method').value = 'POST';
    hidePermChip();
  }
}

function requireOperation() {
  const op = currentOperation();
  if (!op) {
    toast('Fetch the contract and choose an operation first.');
    return null;
  }
  return op;
}

function makeServiceBody() {
  const op = requireOperation();
  if (!op) return;
  const trim = $('#svTrim').checked;
  state.req.body = ws.jsonSkeleton(op, { trim });
  state.req.bodyMode = 'json';
  $('#body').value = state.req.body;
  $('#bodyMode').value = 'json';
  updateServiceUrl();
  switchRequestTab('body');
  toast(`Generated a body for ${op.name}().`);
}

function makeSoapEnvelope() {
  const op = requireOperation();
  if (!op) return;
  const service = $('#svService').value.trim();

  state.req.body = ws.soapEnvelope(op, state.contract?.targetNs, { trim: $('#svTrim').checked });
  state.req.bodyMode = 'xml';
  $('#body').value = state.req.body;
  $('#bodyMode').value = 'xml';

  $('#method').value = 'POST';
  $('#url').value = `{{$baseUrl}}/soap/services/${service}`;
  hidePermChip();

  // Re-inject our own headers: stale copies go first, and a header the user
  // has already set under the same name stays theirs. An identical name *and*
  // value is ours even when the marker was lost (a restored draft), so adopt
  // it before injecting — otherwise it would outlive the request type.
  const soap = Object.entries(ws.soapHeaders(op)).map(([k, v]) => ({ k, v }));
  dropAutoSoapHeaders();
  const adopt = dropAutoHeaders(state.req.headers, soap);
  if (adopt.changed) state.req.headers = adopt.headers;
  state.req.autoSoap = injectAutoHeaders(state.req.headers, soap);
  renderAllKv();
  switchRequestTab('body');
  toast('SOAP envelope generated.');
}

/* ================================================================== *
 * Request snapshots (save / load / history)
 * ================================================================== */

function snapshot(name) {
  return {
    id: globalThis.crypto?.randomUUID ? crypto.randomUUID() : `r_${Date.now().toString(36)}`,
    name: name || 'Request',
    kind: state.kind,
    method: $('#method').value,
    url: $('#url').value,
    params: JSON.parse(JSON.stringify(state.req.params)),
    headers: JSON.parse(JSON.stringify(state.req.headers)),
    autoSoap: JSON.parse(JSON.stringify(state.req.autoSoap || [])),
    body: state.req.body,
    bodyMode: state.req.bodyMode,
    entity: $('#odEntity').value.trim(),
    service: {
      group: $('#svGroup').value.trim(),
      service: $('#svService').value.trim(),
      operation: $('#svOperation').value,
    },
  };
}

function applySnapshot(req, { silent = false } = {}) {
  if (!req) return;
  state.kind = req.kind || 'raw';
  $('#method').value = req.method || 'GET';
  $('#url').value = req.url || '';
  state.req.params = JSON.parse(JSON.stringify(req.params || []));
  state.req.headers = JSON.parse(JSON.stringify(req.headers || []));
  state.req.autoSoap = JSON.parse(JSON.stringify(req.autoSoap || []));
  state.req.body = req.body || '';
  state.req.bodyMode = req.bodyMode || 'none';
  $('#body').value = state.req.body;
  $('#bodyMode').value = state.req.bodyMode;
  $('#odEntity').value = req.entity || '';
  $('#svGroup').value = req.service?.group || '';
  $('#svService').value = req.service?.service || '';
  if (req.service?.operation) $('#svOperation').value = req.service.operation;
  hidePermChip();
  renderKind();
  renderAllKv();
  if (!silent) {
    openPane('build');
    toast(`Loaded “${req.name}”.`);
  }
}

/* ================================================================== *
 * Environments pane
 * ================================================================== */

function wireEnvPane() {
  $('#btnNewEnv').addEventListener('click', () => openEnvForm(null));
  $('#btnCancelEnv').addEventListener('click', () => $('#envForm').classList.add('hidden'));
  $('#btnDeleteEnv').addEventListener('click', deleteEnv);
  $('#btnTestEnv').addEventListener('click', testEnv);
  $('#btnCaptureTab').addEventListener('click', captureFromTab);
  $('#btnSaveEnv').addEventListener('click', () => saveEnv());
  // Belt and braces: never let a stray submit reload the panel.
  $('#envForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveEnv();
  });
  $('#efAuthMode').addEventListener('change', renderAuthFields);
  $('#btnSetup').addEventListener('click', toggleSetup);
  $('#setupBox').addEventListener('click', (e) => {
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      navigator.clipboard?.writeText(copyBtn.dataset.copy).then(
        () => toast('Copied.'),
        () => toast('Clipboard unavailable.'),
      );
      return;
    }
    if (e.target.closest('#setupClose')) $('#setupBox').classList.add('hidden');
    else if (e.target.closest('#setupCheck')) runSetupCheck();
    else if (e.target.closest('#setupEditEnv')) openEnvForm(activeEnv()?.id || null);
  });
  $('#permChip').addEventListener('click', async () => {
    const origin = $('#permChip').dataset.origin;
    if (origin) await requestOriginAccess(origin);
  });
  $('#envSelect').addEventListener('change', async () => {
    state.activeEnvId = $('#envSelect').value || null;
    if (state.activeEnvId) await envApi.setActive(state.activeEnvId);
    renderEnvSelect();
    renderAuthSummary();
    if (!$('#setupBox').classList.contains('hidden')) renderSetup();
    await fillEntityListFromCache();
  });
}

/* ================================================================== *
 * Guided setup — authentication walkthrough for the active environment
 * ================================================================== */

const ENTRA_DOC = 'https://learn.microsoft.com/en-us/entra/identity-platform/howto-create-service-principal-portal';

function copyBtn(value, label = 'Copy') {
  if (!value) return '';
  return ` <button class="btn btn-sm ghost" type="button" data-copy="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
}

function setupRow(label, value, fallback = '') {
  const has = Boolean(value);
  return `
    <div class="setup-row">
      <span class="setup-label">${escapeHtml(label)}</span>
      <code class="setup-val">${escapeHtml(has ? value : fallback || '— not set yet')}</code>
      ${has ? copyBtn(value) : '<span></span>'}
    </div>`;
}

function toggleSetup() {
  const box = $('#setupBox');
  if (box.classList.contains('hidden')) {
    renderSetup();
    box.classList.remove('hidden');
    box.scrollIntoView({ block: 'nearest' });
  } else {
    box.classList.add('hidden');
  }
}

function setupSteps(mode, v) {
  switch (mode) {
    case AUTH_MODES.INTERACTIVE:
      return [
        `In the <a href="${ENTRA_DOC}" target="_blank" rel="noopener noreferrer">Microsoft Entra admin center</a> go to <strong>Entra ID → App registrations → New registration</strong>, name it, pick <em>Accounts in this organizational directory only</em>, then <strong>Register</strong>.`,
        `Copy the <strong>Application (client) ID</strong> into <em>Client ID</em> on the environment form.${v.clientId ? ` <span class="hint">Saved: ${escapeHtml(v.clientId)}</span>` : ''}`,
        `<strong>Authentication → Add a platform → Mobile and desktop applications</strong>, then add this extension's redirect URL: <code>${escapeHtml(v.redirect)}</code>${copyBtn(v.redirect)} — and enable <strong>Allow public client flows</strong> if your tenant offers it.`,
        `<strong>API permissions → Add a permission → APIs my organization uses</strong> → your <code>…operations.dynamics.com</code> resource → <strong>Delegated</strong> → <code>user_impersonation</code> → <strong>Grant admin consent</strong>.`,
        `Save the environment, open the request <strong>Auth</strong> tab and press <strong>Sign in</strong>. Leave <em>Scope</em> blank unless you need something non-standard.`,
      ];
    case AUTH_MODES.CLIENT:
      return [
        `Register an application in the <a href="${ENTRA_DOC}" target="_blank" rel="noopener noreferrer">Microsoft Entra admin center</a> (<strong>Entra ID → App registrations → New registration</strong>, <em>Accounts in this organizational directory only</em>), then copy the <strong>Application (client) ID</strong> into <em>Client ID</em> on the environment form.${v.clientId ? ` <span class="hint">Saved: ${escapeHtml(v.clientId)}</span>` : ''}`,
        `<strong>Certificates &amp; secrets → New client secret</strong> — copy the <em>value</em> once and paste it into <em>Client secret</em>. It is kept on this device, never exported and never displayed.`,
        `<strong>API permissions → Add a permission → APIs my organization uses</strong> → Dynamics 365 Finance and Operations (or your environment) → <strong>Application</strong> permission → <strong>Grant admin consent</strong>. If you cannot grant consent, ask your tenant administrator.`,
        `In F&amp;O open <strong>System administration → Setup → Azure Active Directory applications</strong> (called <em>Microsoft Entra ID applications</em> in newer builds) → <strong>New</strong> → paste the same Client ID, give it a name and choose the service <strong>User ID</strong> it acts as.`,
        `Leave <em>Scope</em> blank to use <code>${escapeHtml(v.scopeClient)}</code>${copyBtn(v.scopeClient)}, then <strong>Save</strong> and press <strong>Get token</strong> on the Auth tab to verify.`,
      ];
    case AUTH_MODES.MANUAL:
      return [
        `Obtain an access token for the F&amp;O resource (Microsoft Entra, Postman or your own tool).`,
        `Paste it into <em>Bearer token</em> on the environment form — stored locally on this device, never exported and never rendered.`,
        `Access tokens usually expire within an hour: paste a fresh one when requests start returning <code>401</code>.`,
      ];
    default:
      return [
        `Sign in to <code>${escapeHtml(v.base || 'your F&amp;O environment')}</code> in this browser profile — the extension reuses that session cookie, so there is nothing else to configure.`,
        `Press <strong>Capture from tab</strong> to pull the URL and legal entity from your open F&amp;O tab.`,
        `Writes (POST / PATCH / DELETE) fetch an anti-CSRF token automatically — no header to paste.`,
        `A <code>401</code>/<code>403</code> means the session expired: sign in again in the browser, then resend.`,
      ];
  }
}

function renderSetup() {
  const env = activeEnv();
  const mode = env?.auth?.mode || AUTH_MODES.SESSION;
  const base = String(env?.baseUrl || '').replace(/\/+$/, '');
  const v = {
    base,
    clientId: env?.auth?.clientId || '',
    tenant: env?.auth?.tenantId || '',
    redirect: chrome.runtime?.id ? `https://${chrome.runtime.id}.chromiumapp.org/callback` : '',
    scopeClient: base ? `${base}/.default` : '',
    scopeUser: base ? `${base}/user_impersonation openid profile offline_access` : '',
  };

  const rows = [
    setupRow('Environment', v.base, 'create an environment first'),
    setupRow('Tenant', v.tenant, 'organizations (default)'),
    setupRow('Client ID', v.clientId),
    setupRow('Scope (default)', mode === AUTH_MODES.CLIENT ? v.scopeClient : v.scopeUser, 'set the environment URL'),
    mode === AUTH_MODES.INTERACTIVE ? setupRow('Redirect URL', v.redirect) : '',
  ].join('');

  $('#setupBox').innerHTML = `
    <div class="row" style="justify-content:space-between">
      <h3>Guided setup</h3>
      <button class="btn btn-sm ghost" id="setupClose" type="button">Close</button>
    </div>
    <p class="hint">Active environment: <strong>${escapeHtml(env?.name || 'none yet')}</strong> —
      <strong>${escapeHtml(MODE_LABEL[mode] || mode)}</strong>.
      <button class="btn btn-sm ghost" id="setupEditEnv" type="button">Edit environment</button></p>
    <div class="setup-values">${rows}</div>
    <ol class="setup-steps">${setupSteps(mode, v).map((s) => `<li>${s}</li>`).join('')}</ol>
    <div class="row wrap">
      <button class="btn btn-sm" id="setupCheck" type="button">Check this environment</button>
    </div>
    <p class="hint" id="setupOut"></p>`;
}

async function runSetupCheck() {
  const env = activeEnv();
  const out = $('#setupOut');
  if (!env) {
    out.textContent = 'No environment selected.';
    return;
  }
  out.className = 'hint';
  out.textContent = 'Checking…';
  const res = await authApi.status(env.id);
  const ready = Boolean(res.ok && res.status?.ready);
  out.textContent = res.ok
    ? `${ready ? '✓' : '⚠'} ${res.status?.note || 'No status reported.'}`
    : `✗ ${res.error?.message || 'Could not read the auth status.'}`;
  out.className = `hint ${ready ? 'status-ok' : 'status-warn'}`;
}

function renderEnvSelect() {
  const select = $('#envSelect');
  if (!state.envs.length) {
    select.innerHTML = '<option value="">No environment — create one</option>';
    $('#envDot').className = 'dot dot-idle';
    return;
  }
  const active = activeEnv();
  select.innerHTML = state.envs
    .map((e) => `<option value="${e.id}" ${e.id === active?.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`)
    .join('');
  $('#envDot').className = `dot ${active?.auth?.mode === AUTH_MODES.SESSION ? 'dot-warn' : 'dot-ok'}`;
}

function renderEnvCards() {
  const list = $('#envCards');
  if (!state.envs.length) {
    list.innerHTML = '<div class="empty">No environments yet. Create one, or capture the tab you have open.</div>';
    return;
  }
  list.innerHTML = state.envs
    .map((e) => {
      const active = e.id === state.activeEnvId;
      return `
      <div class="list-item">
        <div class="li-main">
          <div class="li-title">${escapeHtml(e.name)} ${active ? '· <span class="status-ok">active</span>' : ''}</div>
          <div class="li-sub">${escapeHtml(e.baseUrl)}</div>
          <div class="hint">${escapeHtml(MODE_LABEL[e.auth?.mode] || e.auth?.mode)}${e.company ? ` · ${escapeHtml(e.company)}` : ''}</div>
        </div>
        <div class="li-actions">
          <button class="btn btn-sm" data-use="${e.id}" type="button">Use</button>
          <button class="btn btn-sm" data-edit="${e.id}" type="button">Edit</button>
          <button class="btn btn-sm danger" data-del="${e.id}" type="button">✕</button>
        </div>
      </div>`;
    })
    .join('');

  list.querySelectorAll('[data-use]').forEach((b) =>
    b.addEventListener('click', async () => {
      state.activeEnvId = b.dataset.use;
      await envApi.setActive(state.activeEnvId);
      renderEnvSelect();
      renderEnvCards();
      renderAuthSummary();
      await fillEntityListFromCache();
    }),
  );
  list.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openEnvForm(b.dataset.edit)),
  );
  list.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const env = state.envs.find((e) => e.id === b.dataset.del);
      if (!(await confirmDialog(`Delete environment “${env?.name}” and its cached tokens?`))) return;
      await envApi.remove(b.dataset.del);
      await loadEnvs();
      renderAll();
    }),
  );
}

function openEnvForm(id) {
  const form = $('#envForm');
  state.editingEnvId = id;
  const env = id ? state.envs.find((e) => e.id === id) : null;

  $('#envFormTitle').textContent = env ? `Edit “${env.name}”` : 'New environment';
  $('#efName').value = env?.name || '';
  $('#efUrl').value = env?.baseUrl || '';
  $('#efCompany').value = env?.company || '';
  $('#efAuthMode').value = env?.auth?.mode || AUTH_MODES.SESSION;
  $('#efTenant').value = env?.auth?.tenantId || '';
  $('#efClientId').value = env?.auth?.clientId || '';
  $('#efScope').value = env?.auth?.scope || '';
  $('#efClientSecret').value = '';
  $('#efClientSecret').placeholder = env?.auth?.hasSecret ? '•••••• saved — leave blank to keep' : 'paste the client secret';
  $('#efToken').value = '';
  $('#efToken').placeholder = env?.auth?.hasToken ? '•••••• saved — leave blank to keep' : 'paste a bearer token';
  state.envFormVars = JSON.parse(JSON.stringify(env?.variables || []));
  $('#envFormMsg').textContent = '';
  $('#btnDeleteEnv').disabled = !env;

  renderAuthFields();
  renderAllKv();
  form.classList.remove('hidden');
  form.scrollIntoView({ block: 'start' });
  $('#efName').focus();
}

function renderAuthFields() {
  const mode = $('#efAuthMode').value;
  $('#grpTenant').classList.toggle('hidden', !(mode === AUTH_MODES.INTERACTIVE || mode === AUTH_MODES.CLIENT));
  $('#grpSecret').classList.toggle('hidden', mode !== AUTH_MODES.CLIENT);
  $('#grpToken').classList.toggle('hidden', mode !== AUTH_MODES.MANUAL);
}

async function saveEnv() {
  const payload = {
    id: state.editingEnvId || undefined,
    name: $('#efName').value,
    baseUrl: $('#efUrl').value,
    company: $('#efCompany').value,
    variables: state.envFormVars,
    auth: {
      mode: $('#efAuthMode').value,
      tenantId: $('#efTenant').value,
      clientId: $('#efClientId').value,
      scope: $('#efScope').value,
      clientSecret: $('#efClientSecret').value || undefined, // undefined => keep stored secret
      manualToken: $('#efToken').value || undefined,
    },
  };

  const res = await envApi.save(payload);
  if (!res.ok) {
    $('#envFormMsg').textContent = `✗ ${res.error.message}`;
    return;
  }

  await loadEnvs();
  state.activeEnvId = res.env.id;
  await envApi.setActive(res.env.id);
  $('#envForm').classList.add('hidden');
  renderAll();
  if (!$('#setupBox').classList.contains('hidden')) renderSetup();
  toast(`Environment “${res.env.name}” saved.`);
}

async function deleteEnv() {
  if (!state.editingEnvId) return;
  const env = state.envs.find((e) => e.id === state.editingEnvId);
  if (!(await confirmDialog(`Delete environment “${env?.name}” and its cached tokens?`))) return;
  await envApi.remove(state.editingEnvId);
  $('#envForm').classList.add('hidden');
  await loadEnvs();
  renderAll();
}

async function testEnv() {
  if (!state.editingEnvId) {
    $('#envFormMsg').textContent = 'Save the environment first, then test it.';
    return;
  }
  const msg = $('#envFormMsg');
  msg.textContent = 'Testing…';
  const base = String($('#efUrl').value || '').trim().replace(/\/+$/, '');

  // The background only sends the environment's token to that environment's own
  // origin, so an edited-but-unsaved URL must be saved before it can be tested.
  const saved = state.envs.find((e) => e.id === state.editingEnvId);
  if (originOf(base) !== originOf(saved?.baseUrl)) {
    msg.textContent = 'The URL changed — save the environment first, then test it.';
    return;
  }

  const res = await httpSend({
    url: `${base}/data/$metadata`,
    method: 'GET',
    headers: { Accept: 'application/xml' },
    timeoutMs: 20000,
    auth: { envId: state.editingEnvId },
  });
  if (!res.ok) {
    msg.textContent = `✗ ${res.error.message}`;
    return;
  }
  const r = res.response;
  const ms = res.response.timeMs;
  if (r.status < 400) {
    msg.textContent = `✓ HTTP ${r.status} in ${fmtMs(ms)} — metadata reachable, auth OK.`;
  } else if (r.status === 401 || r.status === 403) {
    msg.textContent = `HTTP ${r.status} — authentication/authorization failed. Check the Auth mode and the Entra ID app ACL (System administration → Setup → Microsoft Entra applications).`;
  } else {
    msg.textContent = `HTTP ${r.status} ${r.statusText} after ${fmtMs(ms)}.`;
  }
}

async function captureFromTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      toast('The active tab’s URL is not available. Open a Dynamics 365 F&O tab, or grant access to this site.');
      return;
    }
    const u = new URL(tab.url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('not a web page');

    openEnvForm(null);
    $('#efUrl').value = u.origin;
    if (!$('#efName').value) $('#efName').value = u.hostname.split('.')[0];
    const cmp = u.searchParams.get('cmp');
    if (cmp) $('#efCompany').value = cmp;
    $('#envFormMsg').textContent = `Captured from ${u.hostname}${cmp ? ` (company ${cmp})` : ''}.`;
  } catch {
    toast('Could not read the active tab. Open a Dynamics 365 F&O page first.');
  }
}

/* ================================================================== *
 * Collections pane
 * ================================================================== */

function wireCollectionsPane() {
  $('#btnNewCol').addEventListener('click', () => {
    const name = $('#colNewName').value.trim();
    if (!name) return toast('Enter a collection name.');
    state.collections.push({
      id: globalThis.crypto?.randomUUID ? crypto.randomUUID() : `c_${Date.now().toString(36)}`,
      name,
      requests: [],
    });
    $('#colNewName').value = '';
    persist.collections();
    renderCollections();
    toast(`Collection “${name}” created.`);
  });
  $('#btnSaveCancel').addEventListener('click', () => $('#saveBox').classList.add('hidden'));
  $('#btnSaveConfirm').addEventListener('click', saveRequest);
}

function openSaveBox() {
  if (!state.collections.length) {
    state.collections.push({
      id: globalThis.crypto?.randomUUID ? crypto.randomUUID() : `c_${Date.now().toString(36)}`,
      name: 'My requests',
      requests: [],
    });
    persist.collections();
  }
  $('#saveCol').innerHTML = state.collections
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join('');
  $('#saveName').value = suggestName();
  $('#saveBox').classList.remove('hidden');
  openPane('collections');
  $('#saveName').focus();
  $('#saveName').select();
}

function suggestName() {
  const url = $('#url').value.trim();
  try {
    // Variables may hold the host, so strip them to get something parseable.
    const resolved = url.replace(/\{\{[^}]+\}\}/g, '');
    const u = new URL(/^https?:\/\//i.test(resolved) ? resolved : `https://placeholder.local${resolved.startsWith('/') ? '' : '/'}${resolved}`);
    return `${$('#method').value} ${u.pathname}`;
  } catch {
    return `${$('#method').value} request`;
  }
}

function saveRequest() {
  const name = $('#saveName').value.trim() || suggestName();
  const colId = $('#saveCol').value;
  const col = state.collections.find((c) => c.id === colId);
  if (!col) return toast('Choose a collection.');
  col.requests = col.requests || [];
  col.requests.unshift(snapshot(name));
  persist.collections();
  $('#saveBox').classList.add('hidden');
  renderCollections();
  toast(`Saved to “${col.name}”.`);
}

function renderCollections() {
  const list = $('#colList');
  if (!state.collections.length) {
    list.innerHTML = '<div class="empty">No collections yet.</div>';
    return;
  }
  list.innerHTML = state.collections
    .map(
      (c) => `
      <div class="list-item" style="flex-direction:column;align-items:stretch">
        <div style="display:flex;gap:8px;align-items:center">
          <div class="li-main"><div class="li-title">${escapeHtml(c.name)}</div>
            <div class="li-sub">${(c.requests || []).length} request(s)</div></div>
          <button class="btn btn-sm danger" data-delcol="${c.id}" type="button">Delete</button>
        </div>
        ${(c.requests || [])
          .map(
            (r) => `
          <div class="list-item">
            <span class="method-tag">${escapeHtml(r.method)}</span>
            <div class="li-main" data-open="${c.id}|${r.id}" style="cursor:pointer">
              <div class="li-title">${escapeHtml(r.name)}</div>
              <div class="li-sub">${escapeHtml(r.url)}</div>
            </div>
            <button class="btn btn-sm danger" data-delreq="${c.id}|${r.id}" type="button">✕</button>
          </div>`,
          )
          .join('')}
      </div>`,
    )
    .join('');

  list.querySelectorAll('[data-delcol]').forEach((b) =>
    b.addEventListener('click', async () => {
      const col = state.collections.find((c) => c.id === b.dataset.delcol);
      if (!(await confirmDialog(`Delete collection “${col?.name}”?`))) return;
      state.collections = state.collections.filter((c) => c.id !== b.dataset.delcol);
      persist.collections();
      renderCollections();
    }),
  );

  list.querySelectorAll('[data-open]').forEach((el) =>
    el.addEventListener('click', () => {
      const [colId, reqId] = el.dataset.open.split('|');
      const col = state.collections.find((c) => c.id === colId);
      const req = col?.requests.find((r) => r.id === reqId);
      applySnapshot(req);
    }),
  );

  list.querySelectorAll('[data-delreq]').forEach((b) =>
    b.addEventListener('click', () => {
      const [colId, reqId] = b.dataset.delreq.split('|');
      const col = state.collections.find((c) => c.id === colId);
      if (!col) return;
      col.requests = (col.requests || []).filter((r) => r.id !== reqId);
      persist.collections();
      renderCollections();
    }),
  );
}

/* ================================================================== *
 * History pane
 * ================================================================== */

function wireHistoryPane() {
  $('#btnClearHist').addEventListener('click', () => {
    state.history = [];
    persist.history();
    renderHistory();
  });
}

function renderHistory() {
  const list = $('#histList');
  $('#histInfo').textContent = state.history.length
    ? `${state.history.length} / ${state.settings.maxHistory}`
    : '';
  if (!state.history.length) {
    list.innerHTML = '<div class="empty">No requests sent yet.</div>';
    return;
  }
  list.innerHTML = state.history
    .map((h, i) => {
      const cls = h.status >= 200 && h.status < 300 ? 'status-ok' : h.status >= 400 ? 'status-bad' : 'status-warn';
      return `
      <div class="list-item">
        <span class="method-tag">${escapeHtml(h.req?.method || 'GET')}</span>
        <div class="li-main" data-hist="${i}" style="cursor:pointer">
          <div class="li-title"><span class="${cls}">${h.status}</span> · ${escapeHtml(h.req?.name || 'Request')}</div>
          <div class="li-sub">${escapeHtml(h.finalUrl || h.req?.url || '')}</div>
        </div>
        <span class="hint">${fmtTime(h.ts)}</span>
      </div>`;
    })
    .join('');

  list.querySelectorAll('[data-hist]').forEach((el) =>
    el.addEventListener('click', () => applySnapshot(state.history[Number(el.dataset.hist)]?.req)),
  );
}

/* ================================================================== *
 * Settings pane
 * ================================================================== */

function wireSettingsPane() {
  $('#setTimeout').addEventListener('change', () => {
    state.settings.timeoutMs = Math.max(1000, Number($('#setTimeout').value) || DEFAULT_SETTINGS.timeoutMs);
    persist.settings();
  });
  $('#setHist').addEventListener('change', () => {
    state.settings.maxHistory = Math.min(500, Math.max(10, Number($('#setHist').value) || 100));
    state.history = state.history.slice(0, state.settings.maxHistory);
    persist.settings();
    persist.history();
  });

  $('#btnExport').addEventListener('click', exportData);
  $('#btnImport').addEventListener('click', () => $('#fileImport').click());
  $('#fileImport').addEventListener('change', importData);
}

async function exportData() {
  const envRes = await envApi.list(); // already redacted: no secrets leave the background
  const payload = {
    app: 'fo-api-studio',
    format: APP.STORAGE_FORMAT,
    version: APP.VERSION,
    exportedAt: new Date().toISOString(),
    environments: envRes.envs || [],
    globals: state.globals.map((g) => (g.secret ? { ...g, value: '' } : g)),
    collections: state.collections,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `fo-api-studio-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Exported (secrets excluded).');
}

async function importData(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    let count = 0;

    for (const env of data.environments || []) {
      const res = await envApi.save({
        name: env.name,
        baseUrl: env.baseUrl,
        company: env.company,
        variables: env.variables || [],
        auth: {
          mode: env.auth?.mode,
          tenantId: env.auth?.tenantId,
          clientId: env.auth?.clientId,
          scope: env.auth?.scope,
        },
      });
      if (res.ok) count++;
    }

    const mergeById = (existing, incoming) => {
      for (const item of incoming || []) {
        const found = existing.find((x) => x.id === item.id);
        if (found) Object.assign(found, item);
        else existing.push(item);
      }
    };
    mergeById(state.globals, data.globals);
    mergeById(state.collections, data.collections);

    await persist.globals();
    await persist.collections();
    await loadEnvs();
    renderAll();
    toast(`Imported ${count} environment(s) plus variables/collections.`);
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  }
}

function renderSettings() {
  $('#setTimeout').value = state.settings.timeoutMs;
  $('#setHist').value = state.settings.maxHistory;
  $('#versionInfo').textContent = `F&O API Studio v${APP.VERSION} · storage format ${APP.STORAGE_FORMAT} · not affiliated with Microsoft.`;
}

/* ================================================================== *
 * Render everything
 * ================================================================== */

function renderAll() {
  renderEnvSelect();
  renderEnvCards();
  renderKind();
  renderAllKv();
  renderAuthSummary();
  renderCollections();
  renderHistory();
  renderSettings();
  $('#body').disabled = state.req.bodyMode === 'none';
}

init();
