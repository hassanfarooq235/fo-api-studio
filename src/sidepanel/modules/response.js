/** Response rendering: badges, Pretty / Table / Headers / Raw views, error guidance. */

import { $, escapeHtml, highlightJson, fmtBytes, fmtMs } from './ui.js';

let bodyEl;
let metaEl;
let view = 'pretty';
let res = null;
let onGrantAccess = null;
let onNextPage = null;
let onRowAction = null;

// Table rows are rendered in windows so a 10k-row page cannot freeze the panel.
const ROW_STEP = 200;
let rowLimit = ROW_STEP;

// Paging: every row loaded so far — page 1 plus each page fetched through the
// "Next page" button — kept in order. null means "this response stands alone".
let pagedRows = null;
let appendedPages = 0;

// Rows behind the buttons in the table's action column (set on every render).
let renderedRows = [];

// The response body is replaced wholesale on each render, so the delegated
// click handler must be attached to the container, exactly once per element.
const boundContainers = new WeakSet();

export function configure({ body, meta, grantAccess, nextPage, rowAction }) {
  bodyEl = body;
  metaEl = meta;
  onGrantAccess = grantAccess;
  onNextPage = nextPage || null;
  onRowAction = rowAction || null;

  if (body && !boundContainers.has(body)) {
    boundContainers.add(body);
    body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-row-act]');
      if (!btn) return;
      const row = renderedRows[Number(btn.dataset.i)];
      if (row) onRowAction?.(btn.dataset.rowAct, row);
    });
  }
}

/**
 * @param {object|null} next
 * @param {{append?: boolean}} [opts] append: keep the rows already on screen
 *   and add this response's rows to them (used by "Next page").
 */
export function setResponse(next, opts = {}) {
  if (!opts.append) {
    pagedRows = null;
    appendedPages = 0;
    rowLimit = ROW_STEP; // a fresh response starts the row window over
  } else if (next?.ok) {
    const incoming = rowsFromJson(next.response?.bodyText || '');
    if (!incoming) {
      // Not a collection (error page, single entity…) — show it on its own.
      pagedRows = null;
      appendedPages = 0;
    } else {
      if (pagedRows === null) {
        // First append: the response still on screen is page 1.
        const prev = res?.ok ? rowsFromJson(res.response?.bodyText || '') : null;
        pagedRows = prev ? [...prev] : [];
      }
      pagedRows.push(...incoming);
      appendedPages += 1;
      view = 'table'; // the rows only make sense where they are visible
    }
  }
  res = next;
  render();
}

/** OData continuation link of the response on screen, if any. */
export function nextPageUrl() {
  return res?.ok ? nextLinkOf(res.response?.bodyText || '') : null;
}

export function setView(nextView) {
  view = nextView;
  render();
}

/** Rows on screen across every loaded page, or null when not paging. */
function combinedRows() {
  return pagedRows && pagedRows.length ? pagedRows : null;
}

/** Copy-friendly text of the current response (all loaded pages when paging). */
export function currentText() {
  if (!res) return '';
  if (!res.ok) return res.error?.message || '';
  const rows = combinedRows();
  if (rows) return JSON.stringify(rows, null, 2);
  return res.response.bodyText || '';
}

export function currentJson() {
  const rows = combinedRows();
  if (rows) return JSON.stringify(rows, null, 2);
  if (res?.ok) {
    try {
      return JSON.stringify(JSON.parse(res.response.bodyText), null, 2);
    } catch {
      return null;
    }
  }
  return null;
}

/** The OData continuation link in a response body, or null. */
function nextLinkOf(bodyText) {
  try {
    const data = JSON.parse(bodyText || '');
    const link = data && typeof data === 'object' ? data['@odata.nextLink'] : null;
    return typeof link === 'string' && link.trim() ? link : null;
  } catch {
    return null;
  }
}

function statusClass(status) {
  if (status >= 200 && status < 300) return 'badge-2xx';
  if (status >= 300 && status < 400) return 'badge-3xx';
  if (status >= 400 && status < 500) return 'badge-4xx';
  return 'badge-5xx';
}

function badges(r) {
  const paging =
    appendedPages && pagedRows
      ? `<span class="badge">${appendedPages + 1} pages · ${pagedRows.length} rows</span>`
      : '';
  return `
    <div class="meta-badges">
      <span class="badge ${statusClass(r.status)}">${r.status} ${escapeHtml(r.statusText || '')}</span>
      <span class="badge">${fmtMs(r.timeMs)}</span>
      <span class="badge">${fmtBytes(r.sizeBytes)}</span>
      ${paging}
    </div>`;
}

/** Continuation control: fetch the next OData page and append it. */
function pagingView(r) {
  const link = nextLinkOf(r.bodyText || '');
  if (!link) return '';
  const which = appendedPages ? `page ${appendedPages + 2}` : 'next page';
  return `
    <div class="pager">
      <button class="btn btn-sm btn-primary" id="resNextPage" type="button">Next page &rarr;</button>
      <span class="hint">${escapeHtml(which)} · rows are added to the table</span>
    </div>`;
}

/**
 * Rendering budgets. A 20 MB $metadata dump or a 10k-row page must never lock
 * the side panel up, so the pretty view degrades in steps:
 *   ≤ HIGHLIGHT_MAX  pretty-printed + syntax highlighted
 *   ≤ PRETTY_MAX     pretty-printed, plain text (highlighting is the slow part)
 *   > PRETTY_MAX     first RAW_WINDOW characters, with a note
 */
const HIGHLIGHT_MAX = 300_000;
const PRETTY_MAX = 2_000_000;
const RAW_WINDOW = 2_000_000;

function windowNote(text) {
  return `<p class="hint">Large response — showing the first ${fmtBytes(RAW_WINDOW)} of ${fmtBytes(text.length)}. Use Copy for the whole body.</p>`;
}

function prettyBody(text) {
  if (text.length > PRETTY_MAX) {
    return `${windowNote(text)}<pre>${escapeHtml(text.slice(0, RAW_WINDOW))}</pre>`;
  }

  try {
    const parsed = JSON.parse(text);
    const pretty = JSON.stringify(parsed, null, 2);
    if (pretty.length > HIGHLIGHT_MAX) {
      return `<p class="hint">Plain view (over ${fmtBytes(HIGHLIGHT_MAX)}) — highlighting skipped to stay responsive.</p><pre>${escapeHtml(pretty)}</pre>`;
    }
    return `<pre>${highlightJson(pretty)}</pre>`;
  } catch {
    if (/^\s*</.test(text)) {
      return `<pre>${escapeHtml(prettyXml(text))}</pre>`;
    }
    return `<pre>${escapeHtml(text)}</pre>`;
  }
}

/**
 * Cheap XML indentation — pure string work, no parsing of untrusted markup.
 * Splitting happens on whole tags (`<[^>]*>`), never across one: the old
 * `>…<` boundary split left `>` and `<` on lines of their own. A short text
 * child (`<return>CUST-0001</return>`) stays on the tag's line.
 */
export function prettyXml(xml) {
  const parts = xml.replace(/>\s*</g, '><').split(/(<[^>]*>)/).filter(Boolean);
  const out = [];
  let depth = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part[0] !== '<') {
      const text = part.trim();
      if (text) out.push('  '.repeat(depth) + text);
      continue;
    }
    const close = part.startsWith('</');
    const meta = part.startsWith('<?') || part.startsWith('<!');
    const open = !close && !meta && !part.endsWith('/>');
    if (close) depth = Math.max(0, depth - 1);

    const name = /^<\/?([^\s/>]+)/.exec(part)?.[1];
    const inline = open && name
      && parts[i + 1] && parts[i + 1][0] !== '<' && parts[i + 1].trim()
      && parts[i + 2] === `</${name}>`;
    if (inline) {
      out.push('  '.repeat(depth) + part + parts[i + 1].trim() + parts[i + 2]);
      i += 2;
      continue;
    }

    out.push('  '.repeat(depth) + part);
    if (open) depth++;
  }
  return out.join('\n');
}

/**
 * Rows of a JSON/OData body, memoised: switching views or clicking "show more"
 * re-renders the same body, and parsing a multi-MB payload each time is what
 * makes panels feel frozen.
 */
let rowsMemo = { text: null, rows: null };

function rowsFromJson(text) {
  if (rowsMemo.text === text && rowsMemo.text !== null) return rowsMemo.rows;
  const rows = computeRows(text);
  rowsMemo = { text, rows };
  return rows;
}

function computeRows(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.value)) return data.value; // OData collection
  if (data && typeof data === 'object') {
    const arrKey = Object.keys(data).find((k) => Array.isArray(data[k]));
    if (arrKey && data[arrKey].length && typeof data[arrKey][0] === 'object') return data[arrKey];
  }
  return null;
}

/**
 * @param {string} text response body
 * @param {string[]|null} [allRows] every row loaded across pages — replaces
 *   whatever is derived from `text` when paging is active.
 */
function tableView(text, allRows = null) {
  const rows = allRows !== null ? allRows : rowsFromJson(text);
  if (!rows || !rows.length) {
    renderedRows = [];
    if (allRows !== null) return '<p class="hint">No rows in the loaded pages.</p>';
    const obj = (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })();
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return kvTable(obj);
    }
    return '<p class="hint">No tabular data found in this response (expected a JSON array or an OData <code>value</code> collection).</p>';
  }

  const limit = rows.slice(0, rowLimit);
  renderedRows = limit;
  const cols = [];
  for (const row of limit) {
    for (const k of Object.keys(row || {})) {
      if (!cols.includes(k) && cols.length < 25) cols.push(k);
    }
  }

  // Record → request: every row carries the two actions that turn it back into
  // a builder entry (they are wired in app.js through configure()).
  const actionCell = onRowAction
    ? `<td class="rowact"><button class="btn btn-sm ghost" type="button" data-row-act="edit" data-i="__I__">Edit</button><button class="btn btn-sm ghost" type="button" data-row-act="delete" data-i="__I__">Delete</button></td>`
    : '';
  const head =
    (onRowAction ? '<th class="rowact">Row</th>' : '') + cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = limit
    .map((row, i) => {
      const tds = cols
        .map((c) => {
          const v = row?.[c];
          const s =
            v !== null && typeof v === 'object' ? JSON.stringify(v) : v === null || v === undefined ? '' : String(v);
          return `<td title="${escapeHtml(s)}">${escapeHtml(s.length > 120 ? `${s.slice(0, 120)}…` : s)}</td>`;
        })
        .join('');
      return `<tr>${onRowAction ? actionCell.replace(/__I__/g, String(i)) : ''}${tds}</tr>`;
    })
    .join('');

  const paged = appendedPages
    ? `<p class="hint">${rows.length} rows across ${appendedPages + 1} pages — Copy returns all of them.</p>`
    : '';
  const hidden = rows.length - limit.length;
  const more = hidden
    ? `<p class="hint">Showing ${limit.length} of ${rows.length} rows.</p>
       <button class="btn btn-sm" id="resMoreRows" type="button">Show ${Math.min(ROW_STEP, hidden)} more</button>`
    : '';
  return `<table class="rtable"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${more}${paged}`;
}

function kvTable(obj) {
  const rows = Object.entries(obj)
    .map(([k, v]) => {
      const s = v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `<tr><th>${escapeHtml(k)}</th><td title="${escapeHtml(s)}">${escapeHtml(s)}</td></tr>`;
    })
    .join('');
  return `<table class="rtable"><tbody>${rows}</tbody></table>`;
}

function headersView(r) {
  const rows = Object.entries(r.headers || {})
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
    .join('');
  return `<table class="rtable"><tbody>${rows}</tbody></table>`;
}

/* ================================================================== *
 * Diagnostics — turn a failure into something actionable.
 *
 * F&O, AAD and the SOAP stack all report errors in their own shape, so
 * this reads whatever the server actually said and pairs it with the fix
 * that applies to that status code. Everything extracted is treated as
 * untrusted text and escaped on the way into the DOM.
 * ================================================================== */

const STATUS_HINTS = {
  400: ['Bad request', 'The payload was rejected — compare it with the entity type, or with the WSDL operation contract.'],
  401: ['Not authenticated', 'Open the Auth tab and sign in (or fetch an app token), then confirm the Entra app registration has an API permission for this resource.'],
  403: ['Not authorized', 'In F&O go to System administration → Setup → Microsoft Entra applications and add this client ID, and give the user a role with the right duty. For cookie-based writes the request is retried once with a fresh anti-CSRF token.'],
  404: ['Not found', 'Check the entity/operation name and the company — try ?cross-company=true, or filter by $filter=dataAreaId eq \'…\'.'],
  405: ['Method not allowed', 'Reads use GET; JSON custom services use POST /api/services/{group}/{service}/{op}; SOAP uses POST /soap/services/{service}.'],
  409: ['Conflict', 'The record already exists or changed meanwhile — re-read it, then retry.'],
  412: ['Precondition failed', 'Send If-Match with the record’s ETag (or "*" to force) on PATCH / PUT / DELETE.'],
  413: ['Payload too large', 'Trim the body — F&O caps request size per environment.'],
  415: ['Unsupported media type', 'JSON bodies need Content-Type: application/json; SOAP envelopes need text/xml; charset=utf-8.'],
  429: ['Throttled', 'Too many requests — wait a moment and send again.'],
  500: ['Server error', 'F&O threw an exception — copy the message and any correlation id below to your admin or the LCS trace.'],
  502: ['Bad gateway', 'The gateway or AOS did not answer — retry, and check the environment status.'],
  503: ['Service unavailable', 'The service is down or restarting — retry shortly.'],
};

const HTML_LOOKS_LIKE = /^\s*<(!doctype|html|head|body)\b/i;
const MAX_MESSAGE = 700;

function clip(text) {
  const s = String(text).trim();
  return s.length > MAX_MESSAGE ? `${s.slice(0, MAX_MESSAGE)}…` : s;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/gi, '&');
}

/** The server's own words for the failure — OData error, SOAP fault or plain text. */
function serverMessage(bodyText) {
  const raw = String(bodyText || '');
  const trimmed = raw.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data = null;
    try {
      data = JSON.parse(trimmed);
    } catch {
      data = null;
    }
    if (!data || typeof data !== 'object') return '';
    const e = data.error;
    if (e && typeof e === 'object') {
      const msg = typeof e.message === 'string' ? e.message : e.message?.value;
      const inner = e.innererror?.message || e.innererror?.internalexception?.message;
      return clip([e.code, msg, inner].filter(Boolean).join('\n')) || clip(String(e.code || ''));
    }
    if (typeof data.message === 'string') return clip(data.message);
    if (typeof data.faultstring === 'string') return clip(decodeEntities(data.faultstring));
    return '';
  }

  if (trimmed.startsWith('<')) {
    const m =
      trimmed.match(/<(?:[\w.]+:)?faultstring[^>]*>([\s\S]*?)<\/(?:[\w.]+:)?faultstring>/i) ||
      trimmed.match(/<(?:[\w.]+:)?message[^>]*>([\s\S]*?)<\/(?:[\w.]+:)?message>/i);
    if (m) return clip(decodeEntities(m[1]).replace(/\s+/g, ' '));
    return '';
  }

  // short plain-text body (nginx, proxies, …)
  return /[<>]/.test(trimmed) ? '' : clip(trimmed);
}

/**
 * Human-readable diagnosis for a response, or null when nothing needs saying.
 * Returns { kind: 'error' | 'warn', title, message, advice }.
 */
export function diagnose(r) {
  if (!r) return null;
  const bodyText = String(r.bodyText || '');

  if (HTML_LOOKS_LIKE.test(bodyText)) {
    const failed = r.status >= 400;
    return {
      kind: failed ? 'error' : 'warn',
      title: failed ? 'HTML instead of data' : 'This is a web page, not data',
      message: 'The server returned an HTML page.',
      advice:
        'That normally means the session expired (you were redirected to sign in) or the URL points at the F&O UI instead of an API path (/data, /api/services, /soap/services). Sign in again from the Auth tab, then resend.',
    };
  }

  if (r.status < 400) return null;
  const [title, advice] =
    STATUS_HINTS[r.status] || ['Request failed', `The server answered ${r.status}${r.statusText ? ` ${r.statusText}` : ''} — read the response body below for the reason.`];

  return { kind: 'error', title, message: serverMessage(bodyText), advice };
}

function diagView(r) {
  const d = diagnose(r);
  if (!d) return '';
  return `
    <div class="diag ${d.kind === 'warn' ? 'diag-warn' : ''}">
      <div class="diag-title">${escapeHtml(d.title)}</div>
      ${d.message ? `<p class="diag-msg">${escapeHtml(d.message)}</p>` : ''}
      <p class="hint">${escapeHtml(d.advice)}</p>
    </div>`;
}

const ERROR_ADVICE = {
  permission: 'Grant the extension access to this origin and retry.',
  auth: 'Open the Auth tab — sign in or fetch an app token, then check the claims.',
  network: 'Verify the base URL, VPN/proxy and that the environment is running.',
  timeout: 'Increase the timeout in Settings, or check whether the environment is slow.',
  input: 'Fix the request before sending it.',
  internal: 'Unexpected error — try again.',
};

function errorView(e) {
  const advice = ERROR_ADVICE[e.kind] || ERROR_ADVICE.internal;
  let action = '';
  if (e.kind === 'permission' && e.origin) {
    action = `<div class="row"><button class="btn btn-sm btn-primary" id="btnGrant" type="button">Grant access to ${escapeHtml(e.origin)}</button></div>`;
  }
  return `
    <div class="meta-badges"><span class="badge badge-4xx">${escapeHtml(e.kind)}</span></div>
    <p><strong>${escapeHtml(e.message)}</strong></p>
    <p class="hint">${escapeHtml(advice)}</p>
    ${action}`;
}

function render() {
  if (!bodyEl) return;

  if (!res) {
    bodyEl.innerHTML = '<p class="hint">Send a request to see its response here.</p>';
    metaEl.textContent = '';
    return;
  }

  if (!res.ok) {
    metaEl.textContent = 'not sent';
    bodyEl.innerHTML = errorView(res.error);
    const btn = bodyEl.querySelector('#btnGrant');
    if (btn) {
      btn.addEventListener('click', async () => {
        const granted = await onGrantAccess?.(res.error.origin);
        if (granted) bodyEl.querySelector('#btnGrant')?.remove();
      });
    }
    return;
  }

  const r = res.response;
  metaEl.textContent = r.finalUrl ? shorten(r.finalUrl) : '';

  // Failure guidance (or an HTML-page warning) sits under the badges, and the
  // continuation button sits above whatever view shows the data.
  const head = badges(r) + diagView(r) + pagingView(r);

  if (view === 'pretty') bodyEl.innerHTML = head + prettyBody(r.bodyText || '');
  else if (view === 'table') bodyEl.innerHTML = head + tableView(r.bodyText || '', pagedRows);
  else if (view === 'headers') bodyEl.innerHTML = head + headersView(r);
  else {
    const raw = r.bodyText || '';
    bodyEl.innerHTML =
      head + (raw.length > RAW_WINDOW ? windowNote(raw) : '') + `<pre>${escapeHtml(raw.slice(0, RAW_WINDOW))}</pre>`;
  }

  bodyEl.querySelector('#resNextPage')?.addEventListener('click', () => onNextPage?.());
  bodyEl.querySelector('#resMoreRows')?.addEventListener('click', () => {
    rowLimit += ROW_STEP;
    render();
  });
}

function shorten(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
