# Chrome Web Store listing — F&O API Studio

Draft copy for the developer dashboard (*Store listing* tab). Field limits are taken from the
official [listing guidelines](https://developer.chrome.com/docs/webstore/best-listing):
item **summary ≤ 132 characters**, screenshots **1280×800 or 640×400** (at least 1, up to 5),
small promo tile **440×280**.

---

## Item title

```
F&O API Studio — D365 API Tester
```

31 characters. Already set in `manifest.json` (`name`), well inside the 75-character limit.
`short_name`: `F&O API Studio`.

## Summary (≤ 132 characters)

```
Postman-style API tester for Dynamics 365 F&O: send OData, JSON and SOAP calls, inspect responses, save environments.
```

Plain text only — no HTML, no keyword stuffing, no comparison with competing extensions.

## Category & language

| Field | Value |
| --- | --- |
| Category | **Developer tools** |
| Language | English |

---

## Description

```
F&O API Studio turns Chrome into a request tester for Dynamics 365 Finance & Operations. Open the side panel next to your environment, build a call, send it, and read the response — without leaving the tab you are working in.

WHAT YOU CAN DO
• OData — load /data/$metadata, browse the entity sets your environment exposes, build collection and key URLs, and generate create or update JSON bodies straight from the entity type. Query options such as $filter, $select, $expand and $top are one click away, with a cross-company toggle built in.
• Custom services in JSON — read the WSDL for a service group, pick an operation, and get a JSON body keyed by the actual parameter names for POST /api/services/{group}/{service}/{operation}.
• Custom services in SOAP — the same contract emitted as a SOAP 1.1 envelope with the correct namespace and SOAPAction header for POST /soap/services/{service}.
• Raw requests — any method, URL, headers, parameters and body you like.
• Environments — save as many environments as you need, with four sign-in modes: reuse your signed-in browser session, Entra ID sign-in with PKCE, an app-only client ID and secret, or a bearer token you paste in.
• Variables — use {{name}} in URLs, headers and bodies. Built-ins such as $baseUrl, $company, $guid and $timestamp combine with your globals and per-environment values, and anything unresolved is reported instead of silently left behind.
• Collections and history — save requests into collections and reopen past calls with one click.
• Responses — Pretty (JSON and XML with syntax highlighting), Table, Headers and Raw views, with status, timing and size badges. "Next page" follows the OData continuation link and appends the rows, and large bodies are windowed so a 10,000-row or 20 MB response stays responsive.
• Actions and functions — call an OData action or function straight from the metadata: parameters become a JSON body (actions) or typed query arguments (functions), bound to the record you are working with.
• Record to request — every row in the Table view carries Edit and Delete, which rebuild a keyed PATCH or DELETE (key from the entity metadata) and reuse the record's ETag as If-Match.
• cURL import — paste a curl command from documentation, a terminal or a colleague and it becomes a ready-to-send request. Credentials on the command line are dropped on purpose.
• Guided setup — a step-by-step walkthrough for each sign-in mode, with copyable values (client ID, scope, redirect URL, default scope) and a live check of the active environment.
• Pick up where you left off — the request in progress is restored the next time the panel opens, and ⌘/Ctrl + Enter sends it.
• Useful errors — 401 and 403 point you at the Entra application access list, 404 hints at company and cross-company settings, 412 flags a stale If-Match, and a blocked request offers a one-click "grant access to this site" action. The server's own message (OData error, SOAP fault) is extracted and shown above the hint.

BUILT FOR PRIVACY
• Your client secrets, tokens and history never leave your machine: there is no server, no analytics and no telemetry of any kind.
• Minimal permissions — just the side panel, local storage and Microsoft sign-in — with access limited to your Dynamics 365 environment and the Microsoft identity endpoints. Other hosts are only reachable after you explicitly grant access to that one site.
• No remote code: everything runs from the packaged extension under a strict content security policy.

F&O API Studio is an independent tool and is not affiliated with, endorsed by or supported by Microsoft. Dynamics 365 is a trademark of the Microsoft group of companies.
```

---

## Screenshots (1280×800, full bleed, square corners, no padding)

All five live in `docs/screenshots/` and are already captured at 1280×800 from the panel preview
(identical markup and styles to the real side panel), so they can be uploaded as-is:

| # | File | Captures | Shows |
| --- | --- | --- | --- |
| 1 | `01-build-odata-pretty.png` | **Build → OData**, response in the Pretty tab | The core loop: entity picker, `Build GET URL`, `Send`, status/time/size badges, highlighted JSON, `Next page` |
| 2 | `02-table-paging.png` | **Response → Table** across two pages | Readable results, Edit / Delete per row (record → request), `2 pages · 6 rows`, the `$skiptoken` continuation in the URL |
| 3 | `03-soap-service.png` | **Custom service → WSDL operation + generated envelope** | Contract-driven operations, the SOAP request and a cleanly indented XML response — the differentiator vs. table-browsing extensions |
| 4 | `04-guided-setup.png` | **Environments → Guided setup** in client-secret mode | Copyable base URL / tenant / client ID / scope, the Entra + F&O steps, "Check this environment" with a live status |
| 5 | `05-collections.png` | **Collections** with a saved request and the save dialog | Saved requests with method tags and URLs, plus how a request is saved into a collection |

To re-shoot: open `tools/panel.preview.html`, build the state, then
`sips --cropToHeightWidth 800 1280 <shot>.png` (the preview window is captured at 1296×1055 CSS,
so the centre crop lands exactly on the panel card).

If you prefer context over the panel alone, capture at 1280×800 with the F&O page behind it and
the side panel open — the empty space then carries the context.

Optional assets:
- **Small promo tile (440×280)** — the `< />` glyph from `assets/icons` on the blue gradient,
  with the product name; keep text minimal.
- **Marquee (1400×560)** — only needed to be considered for featuring.

Icon: the generated `assets/icons/icon128.png` (rounded square, blue gradient, white `< />`).

---

## Website / support / references

| Field | Value |
| --- | --- |
| Website | `https://hassanfarooq235.github.io/fo-api-studio/` (project site) |
| Support email | `hassanfarooq235@gmail.com` |
| Support page | `https://github.com/hassanfarooq235/fo-api-studio/issues` |
| Privacy policy URL | `https://hassanfarooq235.github.io/fo-api-studio/privacy-policy.html` (published `docs/PRIVACY_POLICY.md`) |

---

## Distribution

- Visibility: **Public** (or *Unlisted* for a first review, then switch to Public).
- Regions: all.
- Pricing: free, no in-app purchases, no payments requested — so no payments declaration is
  needed.

---

## Test instructions

Copy-paste for the *Test instructions* field (see also
`docs/PERMISSIONS_JUSTIFICATION.md` §5):

```
1. Click the extension icon to open the side panel.
2. Open Environments → New environment, enter https://<your-env>.operations.dynamics.com, keep
   the default "Browser session" auth mode and save.
3. In Build → OData click "Load metadata", pick an entity set (e.g. CustomersV3), click
   "Build GET URL" then "Send".
4. Inspect the response using the Pretty / Table / Headers / Raw tabs.
5. Save the request from the Collections pane, then reopen it from History.
6. Settings shows timeout, history size, global variables and export.

No account, payment or data from the developer is required. With a Dynamics 365 page open,
"Capture from tab" prefills the environment URL. Without F&O credentials the panel still opens
and reports a clear, actionable authentication message instead of failing silently.
```

---

## Pre-publish reminders

- [x] `manifest.json` → `homepage_url` set to `https://hassanfarooq235.github.io/fo-api-studio/`.
- [x] Contact, repo and privacy-policy values filled in everywhere (contact
      `hassanfarooq235@gmail.com`, repo `https://github.com/hassanfarooq235/fo-api-studio`, policy
      `https://hassanfarooq235.github.io/fo-api-studio/privacy-policy.html`, effective
      October 8, 2026).
- [ ] Privacy tab: single purpose, permission justifications, remote-code = "No", data-usage
      certifications (`docs/PERMISSIONS_JUSTIFICATION.md`).
- [ ] Screenshots at 1280×800 uploaded, promo tile optional.
- [x] Both test suites pass (100 unit + 149 DOM/security assertions).
