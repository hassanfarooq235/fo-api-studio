/** Small DOM/formatting helpers. All output is escaped — no innerHTML with raw data. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let toastTimer = null;
export function toast(message, ms = 2600) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

/**
 * Promise-based confirm dialog.
 * window.confirm()/alert() are unreliable inside Chrome extension panels,
 * so destructive actions use this instead.
 */
export function confirmDialog(message, okLabel = 'Delete') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:100;padding:16px';

    const box = document.createElement('div');
    box.className = 'card';
    box.style.cssText = 'max-width:340px;box-shadow:0 8px 24px rgba(0,0,0,.35)';

    const p = document.createElement('p');
    p.style.margin = '0 0 4px';
    p.textContent = message;

    const row = document.createElement('div');
    row.className = 'row';

    const ok = document.createElement('button');
    ok.className = 'btn btn-sm danger';
    ok.type = 'button';
    ok.textContent = okLabel;

    const cancel = document.createElement('button');
    cancel.className = 'btn btn-sm';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';

    const done = (value) => {
      overlay.remove();
      resolve(value);
    };

    ok.addEventListener('click', () => done(true));
    cancel.addEventListener('click', () => done(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) done(false);
    });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        done(false);
      }
    });

    row.append(ok, cancel);
    box.append(p, row);
    overlay.append(box);
    document.body.append(overlay);
    cancel.focus();
  });
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function fmtMs(n) {
  if (!Number.isFinite(n)) return '';
  return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n} ms`;
}

export function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

/** Escape + syntax-highlight JSON. Returns safe HTML (tokens are escaped individually). */
export function highlightJson(text) {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out += `<span class="${m[2] ? 'tok-key' : 'tok-str'}">${escapeHtml(m[1])}</span>`;
      if (m[2]) out += escapeHtml(m[2]);
    } else if (m[3] !== undefined) {
      out += `<span class="tok-bool">${m[3]}</span>`;
    } else if (m[0] === 'null') {
      out += '<span class="tok-null">null</span>';
    } else {
      out += `<span class="tok-num">${escapeHtml(m[0])}</span>`;
    }
    last = re.lastIndex;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

/**
 * Key/value row editor.
 * @param {HTMLElement} container
 * @param {Array<{k:string,v:string,on:boolean}>} rows mutated in place by inputs
 * @param {(index:number)=>void} onRemove
 */
export function renderKv(container, rows, onRemove) {
  container.textContent = '';
  rows.forEach((row, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'kv-row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = row.on !== false;
    cb.title = 'Enabled';
    cb.addEventListener('change', () => {
      row.on = cb.checked;
    });

    const key = document.createElement('input');
    key.className = 'kv-key';
    key.placeholder = 'key';
    key.value = row.k ?? '';
    key.spellcheck = false;
    key.autocomplete = 'off';
    key.addEventListener('input', () => {
      row.k = key.value;
    });

    const val = document.createElement('input');
    val.placeholder = 'value';
    val.value = row.v ?? '';
    val.spellcheck = false;
    val.autocomplete = 'off';
    val.addEventListener('input', () => {
      row.v = val.value;
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'kv-del';
    del.title = 'Remove';
    del.textContent = '×';
    del.addEventListener('click', () => onRemove(i));

    wrap.append(cb, key, val, del);
    container.append(wrap);
  });
}

/** Turn rows into an object (last duplicate key wins). */
export function rowsToObject(rows) {
  const out = {};
  for (const r of rows || []) {
    if (r && r.on !== false && r.k) out[r.k] = r.v ?? '';
  }
  return out;
}
