# Privacy Policy — F&O API Studio

**Effective date:** October 8, 2026
**Contact:** hassanfarooq235@gmail.com
**Policy URL:** https://hassanfarooq235.github.io/fo-api-studio/privacy-policy.html

F&O API Studio ("the extension") is a client-side tool for testing Dynamics 365 Finance &
Operations APIs. This policy explains what the extension accesses, where that data goes, and
what it does **not** do. It should be read together with the source code, which is open.

> This extension is independent software. It is not affiliated with, endorsed by, or supported
> by Microsoft, and it is not a Microsoft product.

## Short version

- The extension **does not collect, transmit, sell or share any data with the developer.**
- There is **no analytics, telemetry, advertising, fingerprinting or tracking** of any kind.
- All data the extension stores lives **locally in your browser profile** on your device.
- Network requests are made **only** to (a) the Dynamics 365 / API host *you* configure and
  (b) Microsoft identity endpoints when *you* choose a token-based sign-in mode.

## 1. Data the extension accesses

When you use it, the extension reads and writes only what you explicitly ask it to:

| Data | Why | Where it goes |
| --- | --- | --- |
| The base URL, company and name of the environments you create | To address your API host | Local storage, then to that host as part of requests you send |
| Request URLs, methods, headers, parameters and bodies you type | To send the request you built | To the API host you configured, to local history, and to your local draft (so the panel can reopen where you left off — header values that look like credentials are never written to the draft) |
| Responses returned by that host (status, headers, body) | So you can inspect them | Local storage (last responses appear in history until you clear it) |
| OData `$metadata` and WSDL documents fetched from your host | To offer entity/operation pickers and body templates | Cached in local storage (latest 10 entries) |
| Entra ID tenant/client IDs, client secrets, pasted bearer tokens, obtained access tokens | To authenticate your requests | Local storage, readable **only** by the extension's background process |
| Your browser's sign-in session cookies | Only in "session" auth mode, to reuse an existing sign-in | Sent to your configured host, as with any normal page request |
| The address of the browser tab you are on | Only when you click "Capture from tab", to prefill the environment form | Local storage |

The extension does **not** read the contents of web pages you visit, does not inject content
scripts, does not read your browsing history, and does not access location, contacts, files or
any other device data.

## 2. Data stored on your device

Everything is kept in `chrome.storage.local` inside your own Chrome profile, under these keys:
environments (including any secrets you saved), the active environment, cached tokens, global
variables, collections, request history, settings, the metadata cache and the draft of the
request in progress.

- The data never leaves your device except as requests you explicitly send.
- Secrets (client secrets, manual tokens, cached access tokens) are stored in the background
  process and are never handed to the rendered page, never included in exports, and never
  written into copied cURL commands.
- Chrome's normal storage encryption and your profile's protection apply.

## 3. Data transmitted off the device

The extension makes HTTP requests only to:

1. **The API host you configured** — normally `https://<your-env>.operations.dynamics.com`, or
   whatever custom origin you granted access to. This is your own organization's server; your
   data is handled under your organization's policies.
2. **Microsoft identity endpoints** — `login.microsoftonline.com`, used only when you pick the
   interactive or client-credentials sign-in mode.

No request is ever sent to the developer, to an analytics provider, to an advertising network
or to any other third party. The extension contains no tracking pixels, no beacons and no
usage reporting.

## 4. What is explicitly not collected

- Personal information, account identifiers or contact details
- Browsing history or the content of pages you visit
- Search terms, keystrokes or form data outside the extension's own panels
- Device or browser fingerprints, advertising identifiers, IP addresses
- Crash reports, diagnostic logs or performance metrics

## 5. Sharing and sale

Your data is never sold, rented, brokered or shared with third parties, because it is never
collected in the first place. The extension makes no server-to-server calls of its own.

## 6. Retention and deletion

- Data persists only until you delete it or uninstall the extension.
- **History** is capped (default 100 entries) and can be cleared from the Settings pane.
- **Uninstalling** the extension removes all of its local storage, including saved secrets and
  tokens. You can also clear individual items from the Environments, Collections and Settings
  panes.
- Cached access tokens expire on their own (`expires_in`) and are re-fetched only when you
  send an authenticated request.

## 7. Security measures

- Manifest V3 with a strict extension-page CSP (`script-src 'self'; object-src 'self'`): no
  remote code, no `eval`, no dynamically loaded scripts.
- A minimal permission set — `sidePanel`, `storage`, `identity` — plus host access limited to
  `*.dynamics.com` and the Microsoft identity endpoints. All other origins are **optional**
  permissions requested per-origin, only when you click **Grant access**.
- All outbound requests are issued by the background service worker, so bearer tokens are
  attached outside the rendered UI.
- Server-provided data (response bodies, headers, WSDL, `$metadata`) is escaped before being
  displayed, preventing markup injection through API responses.

See [`docs/SECURITY.md`](SECURITY.md) for the full design rationale.

## 8. Children's privacy

The extension is a professional developer tool and is not directed at children under 13. It
does not knowingly collect information from children. If you believe a child has provided
personal data through the extension's storage, contact us and it will be removed.

## 9. Changes to this policy

Any change will be published at https://hassanfarooq235.github.io/fo-api-studio/privacy-policy.html with an updated effective date. Material changes
(such as adding analytics) will be called out explicitly — in practice, the policy will only
ever get shorter in terms of what is collected.

## 10. Your rights and contact

Because the extension collects no data and keeps everything locally, there is no personal-data
store for us to access, export or delete — you control it entirely from your own browser
profile.

Questions, privacy requests or security reports: **hassanfarooq235@gmail.com**.
