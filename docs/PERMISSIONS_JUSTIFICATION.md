# Permission & privacy justifications — Chrome Web Store

Everything on this page is written to be **copied directly into the developer dashboard**
(*Privacy practices* tab) when publishing F&O API Studio. Keep each field short and factual;
if a reviewer asks for more, point them at `docs/SECURITY.md` and the source.

---

## 1. Single purpose description

> Send and inspect requests to Dynamics 365 Finance & Operations APIs from a side panel: build
> OData, JSON custom-service and SOAP calls, then view the responses. Saving environments,
> variables, collections and history exists only to support that testing workflow.

---

## 2. Permission justifications

### API permissions

| Permission | Justification (paste this) |
| --- | --- |
| **`sidePanel`** | Opens the extension's request builder in Chrome's side panel so the user can test APIs next to their Dynamics 365 F&O tabs without leaving the page. |
| **`storage`** | Stores the user's own test data locally and only: environments and their variables, collections, request history, settings, cached `$metadata`/WSDL documents and cached access tokens. Nothing is sent to any server operated by the developer. |
| **`identity`** | Acquires OAuth 2.0 access tokens for the user's own Microsoft Entra ID tenant via `chrome.identity.launchWebAuthFlow` (authorization-code + PKCE) and client-credentials flows, so requests can be authenticated as the user. |

### Host permissions (granted at install)

| Host permission | Justification (paste this) |
| --- | --- |
| `https://*.dynamics.com/*` | The extension sends the API requests the user builds (OData, JSON and SOAP custom services) to their Dynamics 365 F&O environment and reads that environment's `$metadata` and WSDL to generate request bodies. Host access is also what allows these calls to bypass CORS, which would otherwise block cross-origin requests from a side panel. |
| `https://login.microsoftonline.com/*` | Exchanges authorization codes and client credentials for access tokens against the user's Microsoft Entra ID tenant when a token-based sign-in mode is selected. This is the only identity host the extension talks to. |

### Optional host permission

| Permission | Justification (paste this) |
| --- | --- |
| `optional_host_permissions: https://*/*` | Some F&O endpoints are not hosted on `*.dynamics.com` — custom domains, Azure API Management front doors, reverse proxies or local development hosts. The extension requests access to **one specific origin at a time**, only when the user clicks **Grant access**, and Chrome shows its normal permission prompt. The broad pattern exists solely so the *user* can name the origin; the extension never requests or uses access to origins the user did not choose. |

### Permissions deliberately **not** requested

Worth stating proactively if a reviewer asks about tab access or network scope:

- **No `tabs`** — "Capture from tab" reads only the active tab's URL, and Chrome only exposes
  `tab.url` when a host permission already matches (i.e. a Dynamics 365 page). No `tabs`
  permission is declared and no tab data is read otherwise.
- **No `scripting` / no content scripts** — the extension never injects code into web pages.
- **No `webRequest` / `declarativeNetRequest`** — it does not observe, redirect or modify
  traffic; it only issues its own `fetch` calls.
- **No `cookies`** — session mode relies on the browser's ordinary credential handling for the
  extension's own requests, not on the Cookies API.
- **No sovereign-cloud identity hosts** (`login.microsoftonline.us`, `login.chinacloudapi.cn`) —
  the extension currently targets public-cloud F&O (`*.dynamics.com`) only, so those hosts are
  declared neither in `host_permissions` nor used in code. They will be added together with the
  matching F&O hosts when sovereign-cloud support is implemented.
- **No `offscreen`, `downloads`, `clipboardRead`** — copying uses the standard
  `navigator.clipboard.writeText`, which needs no permission and is only invoked by an explicit
  user click.

---

## 3. Remote code declaration

> **No, I am not using remote code.** All scripts are bundled inside the extension package.
> The extension-page CSP is `script-src 'self'; object-src 'self'`, there is no `eval`, no
> `new Function`, no dynamically-created `<script>` elements and no CDN or remote assets.
> Network responses (JSON, XML, WSDL, `$metadata`) are treated strictly as *data* and rendered
> through escaping helpers — never executed.

---

## 4. Data usage disclosure

Answer the dashboard's checkboxes as follows (consistent with `docs/PRIVACY_POLICY.md`):

**"What data does this extension collect?"**
- Leave **all** collection categories unchecked: the extension collects no data for the
  developer — no personal info, no website content, no activity/history, no device info, no
  authentication info, no search terms, no financial/health data.
- If a category forces a choice because data is *stored locally*, note in the free-text/notes
  that all storage is local-only and never transmitted to the developer.

**Certifications to tick:**
- ✅ The extension complies with the [Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).
- ✅ Data is not sold or shared for cross-context behavioural advertising.
- ✅ Data is not used for creditworthiness or lending purposes.
- ✅ The developer does not collect or use data for purposes beyond the extension's single
  stated purpose.

**Privacy policy URL:** the public permalink of `docs/PRIVACY_POLICY.md`.

---

## 5. Test instructions for the reviewer

Paste into the *Test instructions* field (also in `docs/STORE_LISTING.md`):

> 1. Click the extension icon — the side panel opens.
> 2. Open **Environments → New environment**, enter any
>    `https://<your-env>.operations.dynamics.com` URL, choose **Browser session** auth and save.
> 3. In **Build → OData**, click **Load metadata**, pick an entity set (for example
>    `CustomersV3` on the USMF company), click **Build GET URL** and then **Send**.
> 4. Inspect the response in the Pretty / Table / Headers / Raw tabs.
> 5. **Collections** lets you save the request; **History** shows the previous calls;
>    **Settings** has timeout, history size, global variables and export.
>
> The extension does not require an account, payment, or any data of ours to run; a reader
> access to an F&O environment (or any Dynamics 365 page for "Capture from tab") is enough to
> see the full flow. Without F&O credentials the panel still opens, lists its UI and reports a
> clear auth error instead of failing silently.
