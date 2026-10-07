# Security design — F&O API Studio

This document explains how the extension is built to be safe to install, how it meets the
Chrome Web Store's expectations for a Manifest V3 item, and where the residual risks are. It
is written to be read by a reviewer as well as by a security-conscious user.

---

## 1. Assets and trust model

| Asset | Where it lives | Who can see it |
| --- | --- | --- |
| Environments (name, base URL, company, variables) | `chrome.storage.local`, key `envs` | Side panel + background |
| **Client secrets, pasted bearer tokens, cached access tokens** | `chrome.storage.local`, keys `envs` / `tokens` | **Background only** |
| Requests you build (the current draft, with credential-looking header values redacted), collections, history | `chrome.storage.local` | Side panel |
| Responses from your API | Local history, then discarded | Side panel |

**Untrusted inputs** — everything that comes back from a network: response bodies and headers,
`$metadata` documents, WSDL documents, and any URL you paste or reopen from history. None of it
is ever executed or interpolated into markup unescaped.

**Trusted** — the packaged extension code (no remote code), your browser profile, and the host
you deliberately configured.

---

## 2. Two-context architecture

```
┌──────────────────────────────┐        typed messages         ┌──────────────────────────────┐
│ side panel (rendered page)   │  ─────────────────────────▶   │ background service worker    │
│  builds a plain JSON spec    │   http.send / env.* / auth.*  │  owns secrets, does fetch()  │
│  never receives a secret     │  ◀─────────────────────────   │  validates URL + origin      │
└──────────────────────────────┘     redacted results          └──────────────────────────────┘
```

- The panel sends a **request spec** (`url`, `method`, `headers`, `body`, `timeoutMs`,
  `auth.envId`); it never sends credentials and never receives them.
- The message protocol is a closed list of 10 types (`MSG` in `src/shared/constants.js`):
  `http.send`, `env.list|save|delete|active.get|active.set`, `auth.signin|token|status|inspect`.
  There is deliberately **no** "give me the secret" message.
- `env.list` returns **redacted** environments: `auth.hasSecret` / `auth.hasToken` booleans only,
  so even opening DevTools on the panel page cannot read a stored secret.

> This boundary limits the blast radius of a defect in the UI (e.g. an injection bug); it is an
> architectural separation inside one extension origin, not an OS sandbox.

---

## 3. Outbound requests — one choke point

All API traffic goes through `sendRequest()` in `src/background/http.js`. In order:

1. **Scheme allowlist** — the URL must start with `http://` or `https://`. Everything else
   (`file:`, `ftp:`, `data:`, `chrome:`) is refused before any I/O.
2. **Host permission** — the target origin must be covered by `host_permissions`
   (`*.dynamics.com`, `login.microsoftonline.com`) or by an **optional** permission the user
   granted for that specific origin. Without it the request never leaves; the error view
   renders a one-click "Grant access" button instead.
3. **Token scoping** — a bearer token is attached **only when the request origin equals the
   environment's own origin**. A URL pointing anywhere else fails closed with an explicit
   message ("Access token withheld: …"), telling the user to either add an `Authorization`
   header themselves or point the environment at that host. This is asserted by tests
   (`tools/browser.test.html`, "token scoping (security)" section).
4. **Explicit credentials win** — if the user typed an `Authorization` header, it is sent as-is
   and the automatic token path is skipped. Nothing is silently overridden.
5. **Cookie rules** — `session` mode uses `credentials: 'include'`; all bearer modes use
   `credentials: 'omit'`, so cookies for the target host are *not* attached to token-authenticated
   calls (and vice versa).
6. **Bounded timeouts** — clamped to 1–180 s, enforced with `AbortController`.
7. **Redirects** — `redirect: 'follow'`. Per the Fetch standard, a developer-set
   `Authorization` header is removed when a redirect crosses origins, so a redirect cannot carry
   the environment's token to another host.
8. **Errors are classified, never swallowed** — `input` / `auth` / `permission` / `timeout` /
   `network`, each with an actionable message (401/403 → Entra application ACL; 404 → company
   and `cross-company`; blocked host → grant access). Messages never contain token material.

Authentication endpoints are separate from this path and are hard-coded to
`https://login.microsoftonline.com/<tenant>/oauth2/v2.0/…` — the tenant is
`encodeURIComponent`-escaped, so a stored environment cannot turn token exchange into a
request to an arbitrary host.

---

## 4. Secrets

- **Stored locally, background-owned.** Client secrets and pasted tokens live under
  `chrome.storage.local`; the panel only ever sees `hasSecret` / `hasToken` flags and a
  "•••••• saved" placeholder. Leaving a field blank on edit keeps the stored value.
- **Never exported.** Collection/settings exports contain no secrets; **Copy as cURL** replaces
  the token with the literal `<access_token>` (and says so in the toast).
- **Never logged.** There is no `console.*` call anywhere in `src/` (enforced by review; grep it
  yourself: `grep -rn "console\." src`).
- **Never rendered into the DOM.** The only places secrets appear are the password-style inputs
  you type them into.
- **Caching.** Acquired tokens are cached in the background under `tokens`, keyed by
  environment + mode + scope, with a 60 s expiry buffer; they are dropped when the environment
  is deleted.

---

## 5. Rendering untrusted data

Server-provided text is data, never code:

- Every dynamic string that becomes markup passes through `escapeHtml()`.
- JSON/XML highlighting builds escaped tokens; a hostile body such as
  `"<img src=x onerror=…>"` or `"</pre><script>…"` renders as visible text. This is covered by
  explicit regression tests ("hostile JSON is escaped in pretty view").
- WSDL and `$metadata` are parsed with `DOMParser` into XML documents; only element/attribute
  *names and text* are read out of them, and those values are escaped again on the way into the
  UI. XML from the server is never assigned to `innerHTML` directly.
- A pasted cURL command is **tokenised, never executed**: no shell, no interpolation, only
  recognised flags are consumed, credentials passed with `-u`/`-b`/`--user`/`--cookie` are
  dropped with a notice, and headers a browser forbids (`Host`, `Content-Length`, …) are removed.
- Rendering has budgets so a hostile or enormous response cannot lock the panel up: syntax
  highlighting stops at 300 KB, pretty-printing at 2 MB, beyond that the body is windowed with a
  note, and tables render 200 rows at a time behind a "show more" control.
- No `eval`, no `new Function`, no `setTimeout(string)`, no inline event handlers, no
  dynamically created `<script>`.

---

## 6. Content Security Policy and remote code

```json
"content_security_policy": { "extension_pages": "script-src 'self'; object-src 'self'" }
```

- All JavaScript is packaged in the extension; nothing is fetched and executed from a server,
  no CDN, no obfuscated blobs, no `wasm` from the network.
- The store's remote-code declaration is **"No, I am not using remote code."**
- The only outbound data are ordinary `fetch` responses, which are rendered as text (§5).

---

## 7. Permissions

| Permission | Why | Scope |
| --- | --- | --- |
| `sidePanel` | The UI | Extension's own panel |
| `storage` | Local-only data | `chrome.storage.local` |
| `identity` | Entra ID sign-in (auth-code + PKCE, client credentials) | `login.microsoftonline.com` |
| `https://*.dynamics.com/*` | Send API calls, read `$metadata` / WSDL | Public-cloud F&O only |
| `https://login.microsoftonline.com/*` | Token exchange | The only identity host used in code |
| `optional: https://*/*` | Non-`dynamics.com` endpoints (custom domains, APIM, proxies) | Requested **per origin, on user click**, via `chrome.permissions.request` |

Deliberately absent: `tabs`, `scripting`/content scripts, `webRequest`/`declarativeNetRequest`,
`cookies`, `downloads`, `offscreen`, `clipboardRead`, and sovereign-cloud identity hosts (which
the code does not use — declaring them would be over-permissioning). Full justifications:
[`PERMISSIONS_JUSTIFICATION.md`](PERMISSIONS_JUSTIFICATION.md).

Note on tab access: "Capture from tab" calls `chrome.tabs.query` **without** the `tabs`
permission; Chrome only exposes `tab.url` when a host permission already matches (i.e. you are
on a Dynamics 365 page), otherwise the feature politely reports that the URL is unavailable.

---

## 8. Data at rest, and what never happens

- Everything is stored in your own Chrome profile. Uninstalling removes it.
- No analytics, no telemetry, no crash reporting, no advertising SDKs, no third-party servers.
- No browsing-history or page-content access (no content scripts at all).
- No data is transmitted to the developer.

---

## 9. Supply chain

- **Zero runtime dependencies** — no npm packages, no bundler, no lockfile. There is nothing to
  pin, audit or update.
- Source is plain ES modules; `manifest.json` points directly at them.
- Dev-only tooling (`tools/`, including tests and the preview harness) is excluded from the
  store package and is never imported by extension code.

---

## 10. Residual risks (stated honestly)

1. **Local device access.** Anyone with access to your unlocked Chrome profile can read what the
   extension stores, exactly as they could read your browser profile itself. Chrome does not
   expose OS-level keychain storage to extensions.
2. **Shared machine / shoulder-surfing.** History keeps response bodies and request payloads.
   Clear it from the Settings pane, or lower the history limit to 0-equivalent by clearing it.
3. **Session mode uses your cookies.** Requests sent in `session` mode are authenticated as
   *you*; an accidental write call is an authenticated write. Use `clientCredentials` for
   unattended/read-only testing where appropriate.
4. **You choose the target host.** The extension will send whatever request you build to any
   origin you have granted — that is its purpose. The token guard (§3) prevents credentials
   from following a wrong URL, but it cannot stop you from deliberately calling an untrusted
   host with a deliberately pasted header.
5. **Not yet validated against a live tenant.** Logic is covered by 44 unit + 60 DOM/security
   assertions; session-cookie behaviour against real F&O endpoints should be verified before
   publishing.
6. **No request signing or replay protection.** This is a client tool; TLS and the API's own
   authentication are the protections in play.

---

## 11. Verifying the security properties yourself

```sh
# 1. no dynamic code execution, no logging of any kind
grep -rnE "eval\(|new Function|console\." src/        # expected: no output

# 2. unit suite (validation, variables, generators)
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc --module-file=tools/unit.test.js

# 3. DOM + security suite (XSS escaping, token scoping, origin guard)
python3 tools/serve.py          # no-store dev server
# open http://127.0.0.1:8766/tools/browser.test.html
```

Expected: `✓ all 44 assertions passed` and `PASS 60`.

## 12. Reporting a problem

Please open an issue on the project repository or email **hassanfarooq235@gmail.com** with the
extension version (`chrome://extensions`) and steps to reproduce. Do not include real
credentials or tokens in a report.
