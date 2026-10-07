# Changelog

All notable changes to F&O API Studio. The extension follows semantic versioning; the version
in `manifest.json` is the source of truth.

## 0.1.0 — first publishable build

### Request building

- **OData** — live `$metadata` reader: public entity sets, entity keys and properties, collection
  and key URL builders, create/update JSON bodies generated from the entity type,
  `cross-company` toggle and query-option chips.
- **OData actions and functions** — actions are built as `POST` with a JSON body of parameter
  placeholders (the binding parameter excluded); functions are built as `GET` with typed
  arguments in the URL parentheses, blank optional arguments omitted. Bound operations require
  an entity key and say so instead of producing a broken URL.
- **Custom services (JSON and SOAP)** — WSDL-driven operation picker, JSON body keyed by the
  WSDL parameter names, or a SOAP 1.1 envelope with the namespace and `SOAPAction` taken from
  the binding.
- **Raw requests** — any method, URL, headers, params and body.
- **cURL import** — a pasted `curl` command is tokenised (quotes, backslash continuations,
  `-XPOST`-style attached values, `-G` data → params) and mapped onto method, URL, headers and
  body. Credentials (`-u`, `-b`, `--user`, `--cookie`) and file reads (`-d @file`) are dropped
  with a notice; browser-forbidden headers are removed; body type is detected (JSON/XML/text).
- **cURL export** — copy the current request as `curl`, with the bearer token replaced by
  `<access_token>`.
- **Draft persistence** — the in-progress request is saved (debounced) and restored the next
  time the panel opens. Header values that look like credentials are redacted before the draft
  is written, and nothing is saved until the restore has completed so an early window `blur`
  cannot wipe it.
- **Keyboard** — ⌘/Ctrl + Enter sends (exposed through `aria-keyshortcuts`).

### Environments and auth

- Four auth modes: browser **session**, Entra **interactive** (auth-code + PKCE via
  `chrome.identity.launchWebAuthFlow`), **client credentials**, and a pasted **manual** bearer
  token. Secrets are owned by the background service worker; the panel only ever sees
  `hasSecret` / `hasToken`.
- **Capture from tab** fills the URL and legal entity from the open F&O page.
- **Guided setup** — per-mode walkthrough rendered from the active environment: copyable base
  URL, tenant, client ID, default scope and PKCE redirect URL, the Azure-side registration
  steps, the F&O *System administration → Setup → Azure Active Directory applications* step, and
  a live **Check this environment** status. Values refresh when the environment is edited or
  switched.
- Origin guard: a bearer token is only attached when the request origin equals the environment
  origin; an explicit `Authorization` header is the escape hatch, and testing a connection
  refuses a form URL that differs from the saved one.

### Sending and responses

- **Anti-CSRF handshake** for cookie-authenticated writes: a `GET` probe with
  `x-csrf-token: fetch` against the service root (cached per origin), the token attached to the
  real request, and exactly one retry after a `403` with a freshly minted token. Bearer modes
  never probe; probe failures never block the request.
- **Diagnostics** — status-code hint table plus extraction of the OData `error.code` /
  `error.message` / `innererror`, the SOAP `faultstring`, or plain text, with actionable advice
  (including "this looks like the F&O UI, not the API" and "your session expired"). Everything
  is escaped on render.
- **Paging** — `@odata.nextLink` is detected, offered as **Next page**, and appended to the
  table in order; badges show `N pages · M rows`, Copy returns every loaded page.
- **Record → request** — every Table row carries **Edit** / **Delete**: the key comes from
  `$metadata`, the PATCH body is prefilled from the row's scalar properties, and the row's
  `@odata.etag` becomes `If-Match` when present (otherwise `If-Match: *` is defaulted for
  PATCH/PUT/DELETE).
- **Views** — Pretty (JSON with syntax highlighting; XML indented per tag with short scalar
  children kept inline), Table (windowed at 200 rows with
  "show more", 25 columns), Headers and Raw; status/time/size badges; copy and export.
- **XML bodies are indented, not mangled** — tokenising happens on whole tags, so open tags keep
  their brackets and attributes, nesting is reflected in the indent, and `<return>CUST-0001</return>`
  stays on one line. (An earlier boundary-based split put every `<` and `>` on a line of its own.)
- **Panel-injected headers stay with their request type** — the `Content-Type: text/xml` and
  `SOAPAction` rows a generated envelope adds are shown in the Headers tab while you work, but are
  dropped when you leave the service builder (a header you edited is left alone). Without that, an
  OData PATCH would still be announcing `text/xml` and be rejected by F&O.
- **GET and HEAD transmit no body** — a payload has no defined semantics for those methods, so the
  body stays in the editor but is not sent and no `Content-Type` is invented for it; the send hint
  says so, and the cURL export follows the same rule.
- **Rendering budgets** — highlighting stops at 300 KB, pretty-printing at 2 MB, beyond that the
  body is windowed with a note, and parsed rows are memoised so view switching does not reparse
  a multi-MB payload.

### Storage, privacy and security

- Manifest V3, side panel, module service worker; permissions limited to `sidePanel`,
  `storage`, `identity`; host access limited to `https://*.dynamics.com/*` and
  `https://login.microsoftonline.com/*`, everything else behind an explicit per-origin grant.
- `script-src 'self'; object-src 'self'`, no remote code, no analytics, no third-party requests.
- Exports exclude secrets; history and drafts are local-only; uninstalling removes everything.

### Tests and tooling

- `tools/unit.test.js` — 100 pure-logic assertions (variables, URL generation, WSDL/SOAP,
  metadata operations, cURL import, the send rules for injected headers and body-per-method)
  run on the macOS JavaScriptCore binary.
- `tools/browser.test.html` — 149 DOM/security assertions (parsing, rendering, XML and JSON
  pretty-printing, escaping, origin scoping, paging, diagnostics, row actions, render budgets).
- `tools/panel.preview.html` + `tools/dev-shim.js` — the whole panel in a plain tab with a
  `chrome.*` shim whose storage is backed by `localStorage` (so persistence can be exercised);
  append `?reset` to start clean.
- `tools/serve.py` — no-store dev server so an edited module is never served from cache.

### Known limitations

- Session-cookie writes and the anti-CSRF handshake still need verification against a real
  tenant; the live behaviour of `x-csrf-token: fetch` is stated honestly in
  [`SECURITY.md`](SECURITY.md) §10.
- No scripting/assertion engine — deliberately out of scope for this release.
