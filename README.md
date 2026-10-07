# F&O API Studio

A Postman-style API tester for **Dynamics 365 Finance & Operations**, shipped as a Chrome side
panel. Build and send OData, JSON custom-service and raw HTTP requests against your F&O
environment, inspect the responses, and keep environments, variables, collections and history
on your own machine.

> Not affiliated with, endorsed by, or supported by Microsoft. Dynamics 365 is a trademark of
> the Microsoft group of companies.

## What it does

| Area | Capability |
| --- | --- |
| **OData** | Reads `/data/$metadata`, lists public entity sets, builds collection/key URLs, generates create/update JSON bodies from the entity type, `cross-company` toggle, query-option chips (`$filter`, `$select`, `$expand`, `$top`, …), runs **actions and functions** (POST with a parameter body / GET with typed arguments), follows `@odata.nextLink` (**Next page** appends to the table) |
| **Record → request** | Every Table row carries **Edit** / **Delete**: the entity key comes from `$metadata`, the body is pre-filled from the row, and the row's `@odata.etag` is reused as `If-Match` |
| **Custom service (JSON)** | Reads `/soap/services/{name}?wsdl`, lists operations, generates a JSON body keyed by the WSDL parameter names → `POST /api/services/{group}/{service}/{operation}` |
| **Custom service (SOAP)** | Same contract, emitted as a SOAP 1.1 envelope with the `SOAPAction` header taken from the binding → `POST /soap/services/{service}` |
| **Raw** | Any method, URL, headers, params and body |
| **cURL** | Import a pasted `curl` command (quotes, line continuations, `-X`/`-H`/`-d`/`-G`, credentials dropped) or copy the current request as cURL with a token placeholder |
| **Environments** | Saved environments with four auth modes (below), per-environment variables, "capture from the open tab", plus a **Guided setup** walkthrough with copyable values and a live check |
| **Variables** | `{{name}}` resolution across built-ins (`$baseUrl`, `$company`, `$guid`, `$timestamp`, …), globals and environment variables — unresolved names are reported, never silently dropped |
| **Collections & history** | Save requests into collections, re-open past calls from history (settings cap history at 100 by default) |
| **Responses** | Pretty (JSON/XML highlighted), Table, Headers and Raw views, status / time / size badges, paging and a row window that keeps huge payloads responsive, and **diagnostics** that extract the OData `error` / SOAP `faultstring` / plain-text message with an actionable hint (401 → Entra app ACL, 404 → company & `cross-company`, 412 → stale `If-Match`, blocked host → grant access) |
| **Draft & shortcuts** | The in-progress request is restored the next time the panel opens (credential-looking headers are redacted before saving); **⌘/Ctrl + Enter** sends |

**Auth modes** (per environment):

1. `session` — reuse the signed-in browser session (zero configuration)
2. `interactive` — Entra ID auth-code + PKCE through `chrome.identity.launchWebAuthFlow`
3. `clientCredentials` — app-only client ID + client secret
4. `manual` — a bearer token you paste in

## Security model (why it can be published)

- **Least privilege.** Only `sidePanel`, `storage` and `identity`; host access limited to
  `https://*.dynamics.com/*` (your environments) and `https://login.microsoftonline.com/*`
  (token exchange). Anything else (custom domains, APIM, on-prem proxies) is an *optional*
  permission requested per-origin when you click **Grant access** — never silently.
- **Secrets never reach the UI.** Client secrets, manual tokens and cached access tokens live in
  the background service worker. The panel only ever sees `hasSecret` / `hasToken` flags; every
  outbound `Authorization` header is attached in the background. Exports and cURL snippets use a
  `<access_token>` placeholder instead of the real value.
- **No remote code.** `script-src 'self'; object-src 'self'`, no `eval`, no `new Function`, no
  CDN scripts, no dynamically injected code. Response bodies are rendered through escaped,
  highlighted HTML — never raw `innerHTML`.
- **No telemetry.** No analytics, no tracking, no third-party servers. Requests go only to the
  environment you configured and to Microsoft's identity endpoints.

Details: [`docs/SECURITY.md`](docs/SECURITY.md) ·
[`docs/PRIVACY_POLICY.md`](docs/PRIVACY_POLICY.md) ·
[`docs/PERMISSIONS_JUSTIFICATION.md`](docs/PERMISSIONS_JUSTIFICATION.md)

## Repository layout

```
manifest.json            Manifest V3, side panel, module service worker
src/shared/              constants, storage wrapper, variable engine, URL/origin helpers,
                         error helpers
src/background/          service worker: envs (redacted), auth (token flows), http (fetch)
src/sidepanel/           index.html, styles.css, app.js, modules/{gateway,odata,
                         webservice,response,curl,ui}.js
assets/icons/            generated icon set (16/32/48/128)
tools/                   DEV ONLY — unit tests, browser tests, UI preview, no-store dev
                         server, icon generator
docs/                    Chrome Web Store submission documents
```

`tools/` is **never imported by extension code** and should be excluded from the store ZIP
(see below).

## Load unpacked

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Click the toolbar icon — the side panel opens.

**Keyboard:** ⌘/Ctrl + Enter sends the request (while the Build view is active).

## Development & tests

Start the dev server first — it serves with `Cache-Control: no-store`, so an edited module can
never be silently run from the browser's HTTP cache (which makes fixed bugs look broken):

```sh
python3 tools/serve.py        # http://127.0.0.1:8766  (or pass a port)
```

Pure-logic suite (100 assertions: variables, URL generation, WSDL/SOAP, metadata operations,
cURL import, the panel's send rules — which headers it may inject and which methods may carry a
body) — runs on the JavaScriptCore binary bundled with macOS:

```sh
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
  --module-file=tools/unit.test.js
```

DOM + security suite (149 assertions: WSDL parsing, metadata, response rendering — including
XML pretty-printing — XSS escaping, bearer-token origin scoping, paging, error diagnostics, row
actions, render budgets) — open `http://127.0.0.1:8766/tools/browser.test.html`.

Interactive UI preview (the whole panel with a stubbed `chrome.*`, useful without loading the
extension) — open `http://127.0.0.1:8766/tools/panel.preview.html`. The preview backs its
storage with `localStorage` so environments, drafts and history survive a reload;
append `?reset` once to start clean.

Regenerate the icons after a design change:

```sh
python3 tools/make_icons.py
```

## Package for the Chrome Web Store

```sh
cd fo-api-studio
zip -qr fo-api-studio.zip . -x "tools/*" "docs/*" ".git/*" ".gitignore" "fo-api-studio.zip"
```

The archive is written inside the project (and excludes itself): `manifest.json`, `src/`,
`_locales/`, `assets/` and `README.md` — no tests, no docs, no screenshots. Upload that ZIP on
the [developer dashboard](https://chrome.google.com/webstore/devconsole).

## Pre-submission checklist

- [x] **`homepage_url`** in `manifest.json` set to the project site
      (`https://hassanfarooq235.github.io/fo-api-studio/`).
- [x] **Privacy policy published** — [`docs/PRIVACY_POLICY.md`](docs/PRIVACY_POLICY.md) is
      rendered by `tools/md2html.py` to `docs/privacy-policy.html` and served from GitHub Pages at
      `https://hassanfarooq235.github.io/fo-api-studio/privacy-policy.html`. Paste that URL into
      the developer account and the item's privacy field when you fill the dashboard.
- [ ] Fill **permissions justifications, single-purpose description and the remote-code
      declaration** — all copy-paste ready in
      [`docs/PERMISSIONS_JUSTIFICATION.md`](docs/PERMISSIONS_JUSTIFICATION.md).
- [ ] Fill the **store listing** (title, 132-char summary, description, test instructions) —
      draft in [`docs/STORE_LISTING.md`](docs/STORE_LISTING.md).
- [x] **5 screenshots at 1280×800** — captured in `docs/screenshots/` (`01-build-odata-pretty`,
      `02-table-paging`, `03-soap-service`, `04-guided-setup`, `05-collections`); the story each
      one tells is in [`docs/STORE_LISTING.md`](docs/STORE_LISTING.md). They were taken from the
      panel preview (identical markup and styles to the real side panel) and cropped with
      `sips --cropToHeightWidth 800 1280 <shot>.png`. Only the optional 440×280 promo tile is
      still open.
- [x] **Both test suites green** — 100 unit assertions, 149 DOM/security assertions. Still to do:
      exercise the extension against a real F&O environment (see limitations).
- [ ] Register / verify the developer account (one-time US$5 fee) — yours to do; the copy for
      every field is ready in `docs/`.

### Project links

| | |
| --- | --- |
| Repository | https://github.com/hassanfarooq235/fo-api-studio |
| Project site / homepage | https://hassanfarooq235.github.io/fo-api-studio/ |
| Privacy policy URL | https://hassanfarooq235.github.io/fo-api-studio/privacy-policy.html |
| Contact / support | hassanfarooq235@gmail.com |

## Known limitations & risks

- **Live F&O not yet exercised.** Session-cookie auth can be rejected by endpoints that require
  a `Bearer` token strictly; that is exactly why `interactive`, `clientCredentials` and `manual`
  exist, and why a 401/403 surfaces a "check the Entra app ACL / try another auth mode" hint.
  Verify against your own tenant before publishing.
- **Metadata/WSDL are read live**, so the entity list shows only what the environment exposes
  anonymously or to your token (F&O hides non-public entity sets).
- **No request scripting/assertions engine** — deliberately out of MVP scope.

## License

Add a license file before publishing the source repository publicly.
