/**
 * cURL import — turn a pasted `curl …` command into a request.
 *
 * A hand-rolled tokenizer rather than a regex sweep: cURL accepts single and
 * double quotes, backslash line continuations and `-XPOST`-style attached
 * values, so anything that is not understood is reported instead of being
 * half-imported.
 *
 * Safety: nothing here is evaluated — the shell string is only split up, and
 * only recognised flags are consumed. Credentials typed on the command line
 * (`-u`, `-b`) are reported as notes and deliberately dropped, so a pasted
 * command cannot smuggle a password into a stored header.
 */

/** A positional token is only taken as the URL when it actually looks like one. */
const URL_ISH = /^(https?:\/\/|{{|\/)|^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i;

/** Long flags whose value we read and map onto the request. */
const LONG_USED = new Map([
  ['request', 'method'],
  ['header', 'header'],
  ['data', 'data'],
  ['data-raw', 'data'],
  ['data-binary', 'data'],
  ['data-ascii', 'data'],
  ['data-urlencode', 'data'],
  ['json', 'data'],
  ['user-agent', 'user-agent'],
  ['referer', 'referer'],
  ['url', 'url'],
  ['get', 'get'],
  ['head', 'head'],
]);

/** Long flags that take a value we have no use for — consumed so it cannot be mistaken for the URL. */
const LONG_IGNORED = new Set([
  'user', 'cookie', 'cookie-jar', 'output', 'upload-file', 'form', 'form-string', 'proxy',
  'resolve', 'cacert', 'capath', 'cert', 'cert-type', 'key', 'key-type', 'pass', 'engine',
  'max-time', 'connect-timeout', 'speed-limit', 'speed-time', 'limit-rate', 'retry',
  'retry-delay', 'retry-max-time', 'write-out', 'abstract-unix-socket', 'config',
  'tls-max', 'tls13-ciphers', 'ciphers', 'pinnedpubkey', 'haproxy-clientcert', 'telnet-option',
  'range', 'continue-at',
]);

/** Short flags whose value we read and map onto the request. */
const SHORT_USED = new Map([
  ['X', 'method'],
  ['H', 'header'],
  ['d', 'data'],
  ['A', 'user-agent'],
  ['e', 'referer'],
  ['G', 'get'],
  ['I', 'head'],
]);

/**
 * Short flags that take a value we ignore. Only flags that really do take a
 * value belong here: guessing "takes a value" for a boolean flag would eat the
 * URL, while the opposite mistake just leaves an ignorable token behind.
 */
const SHORT_IGNORED = new Set([
  'u', 'b', 'o', 'F', 'm', 'T', 'K', 'P', 'E', 'w', 'Y', 'y', 'C', 'Q', 'r', 't',
]);

/** Short credentials flags — dropped, but worth telling the user about. */
const SHORT_CREDENTIAL = new Set(['u', 'b']);

/** Headers a browser fetch() may not carry anyway — dropped instead of silently ignored later. */
const FORBIDDEN_HEADERS = new Set([
  'host', 'content-length', 'connection', 'transfer-encoding', 'keep-alive', 'expect', 'upgrade',
]);

/**
 * Split a command string into tokens, honouring shell quoting and the
 * backslash-newline continuation curl writes for long commands.
 * @param {string} cmd
 * @returns {string[]}
 */
export function tokenizeCurl(cmd) {
  const src = String(cmd || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\\\n/g, ' ');
  const out = [];
  let cur = '';
  let started = false;
  let i = 0;

  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) {
      cur += src[i + 1];
      started = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      started = true;
      if (end === -1) {
        cur += src.slice(i + 1);
        i = src.length;
      } else {
        cur += src.slice(i + 1, end);
        i = end + 1;
      }
      continue;
    }
    if (c === '"') {
      started = true;
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && '"\\$`'.includes(src[i + 1] || '')) {
          cur += src[i + 1];
          i += 2;
        } else {
          cur += src[i];
          i++;
        }
      }
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      if (started) out.push(cur);
      cur = '';
      started = false;
      i++;
      continue;
    }
    cur += c;
    started = true;
    i++;
  }
  if (started) out.push(cur);
  return out;
}

function detectBodyMode(body) {
  const t = String(body || '').trim();
  if (!t) return 'none';
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      JSON.parse(t);
      return 'json';
    } catch {
      /* not JSON after all */
    }
  }
  if (t.startsWith('<')) return 'xml';
  return 'text';
}

/**
 * @param {string} cmd a pasted `curl …` command
 * @returns {{error: string}|{method: string, url: string,
 *   headers: Array<{k:string,v:string,on:boolean}>,
 *   params: Array<{k:string,v:string,on:boolean}>,
 *   body: string, bodyMode: string, notes: string[]}}
 */
export function parseCurl(cmd) {
  const tokens = tokenizeCurl(cmd);
  if (!tokens.length) return { error: 'Paste a curl command first.' };
  if (!/^curl$/i.test(tokens[0])) return { error: 'The command must start with “curl”.' };

  const notes = [];
  const headers = [];
  const params = [];
  const dataParts = [];
  let method = null;
  let url = '';
  let asGet = false;
  let asHead = false;
  let extraPositional = false;

  const addHeader = (line) => {
    const s = String(line);
    if (s.trim().endsWith(';')) {
      notes.push(`Suppressed header “${s.trim().slice(0, -1)}” was ignored.`);
      return;
    }
    const idx = s.indexOf(':');
    if (idx <= 0) {
      notes.push(`Header without a value ignored: “${s}”`);
      return;
    }
    const k = s.slice(0, idx).trim();
    const v = s.slice(idx + 1).trim();
    if (!k) {
      notes.push(`Header without a name ignored: “${s}”`);
      return;
    }
    if (FORBIDDEN_HEADERS.has(k.toLowerCase())) {
      notes.push(`Dropped browser-controlled header “${k}”.`);
      return;
    }
    if (k.toLowerCase() === 'authorization') {
      notes.push('Imported the Authorization header — the Auth tab is the safer home for tokens.');
    }
    const at = headers.findIndex((h) => h.k.toLowerCase() === k.toLowerCase());
    if (at >= 0) headers.splice(at, 1); // curl keeps the last value
    headers.push({ k, v, on: true });
  };

  const addData = (value) => {
    if (asGet) {
      const eq = String(value).indexOf('=');
      if (eq > 0) params.push({ k: value.slice(0, eq), v: value.slice(eq + 1), on: true });
      else notes.push(`Ignored --get data without a key: “${value}”`);
      return;
    }
    if (String(value).startsWith('@')) {
      notes.push('A body read from a file (@…) cannot be imported — paste it into the Body tab.');
      return;
    }
    dataParts.push(String(value));
  };

  const apply = (kind, value) => {
    switch (kind) {
      case 'method':
        method = String(value).toUpperCase();
        break;
      case 'header':
        addHeader(value);
        break;
      case 'data':
        addData(value);
        break;
      case 'user-agent':
        headers.push({ k: 'User-Agent', v: String(value), on: true });
        break;
      case 'referer':
        headers.push({ k: 'Referer', v: String(value), on: true });
        break;
      case 'get':
        asGet = true;
        break;
      case 'head':
        asHead = true;
        break;
      case 'url':
        url = String(value);
        break;
      default:
        break;
    }
  };

  const takeValue = (flagLabel) => {
    const value = tokens[i++];
    if (value === undefined) throw new Error(`${flagLabel} needs a value.`);
    return value;
  };

  let i = 1;
  try {
    while (i < tokens.length) {
      const tok = tokens[i];
      i++;

      if (tok === '-') continue; // stdin: nothing to read

      // shell redirection (`> out.txt`, `2>err`) — skip both halves
      if (/^[0-9]*[<>]/.test(tok)) {
        i++;
        continue;
      }

      if (tok.startsWith('--')) {
        const eq = tok.indexOf('=');
        const name = eq === -1 ? tok.slice(2) : tok.slice(2, eq);
        const inline = eq === -1 ? null : tok.slice(eq + 1);

        if (LONG_IGNORED.has(name)) {
          if (inline === null) takeValue(`--${name}`); // swallow so it cannot look like the URL
          if (name === 'user' || name === 'cookie' || name === 'cookie-jar') {
            notes.push(`Ignored credentials passed with --${name}.`);
          }
          continue;
        }
        const kind = LONG_USED.get(name);
        if (kind) {
          if (kind === 'get' || kind === 'head') {
            apply(kind, '');
            if (inline !== null) notes.push(`--${name} does not take a value; “${inline}” was ignored.`);
          } else {
            apply(kind, inline !== null ? inline : takeValue(`--${name}`));
          }
          continue;
        }
        // Unknown long flag: assume boolean (a value, if any, is caught by URL_ISH below).
        continue;
      }

      if (tok.length > 1 && tok.startsWith('-')) {
        const chars = tok.slice(1);
        let j = 0;
        while (j < chars.length) {
          const c = chars[j];
          const kind = SHORT_USED.get(c);
          if (kind) {
            const rest = chars.slice(j + 1);
            if (kind === 'get' || kind === 'head') apply(kind, '');
            else apply(kind, rest !== '' ? rest : takeValue(`-${c}`));
            break;
          }
          if (SHORT_IGNORED.has(c)) {
            if (SHORT_CREDENTIAL.has(c)) notes.push(`Ignored credentials passed with -${c}.`);
            if (chars.slice(j + 1) === '') takeValue(`-${c}`);
            break;
          }
          // Unknown short flag: assume boolean and keep scanning (e.g. -sSL).
          j++;
        }
        continue;
      }

      // Positional: the URL is the first one that looks like a location.
      if (!url && URL_ISH.test(tok)) url = tok;
      else extraPositional = true;
    }
  } catch (err) {
    return { error: String(err?.message || err) };
  }

  if (!url) return { error: 'No URL found in the command — e.g. curl "https://…/data/CustomersV3".' };
  if (extraPositional) notes.push('Extra arguments were ignored.');

  if (!method) method = asGet ? 'GET' : asHead ? 'HEAD' : dataParts.length ? 'POST' : 'GET';
  const body = asGet || !dataParts.length ? '' : dataParts.join('&');

  return { method, url, headers, params, body, bodyMode: detectBodyMode(body), notes };
}
