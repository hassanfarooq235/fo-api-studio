# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security-sensitive findings.

- **Email:** hassanfarooq235@gmail.com — subject line `fo-api-studio security`
- Include: what you found, which file or flow is affected, reproduction steps, and the
  extension version (`chrome://extensions`).

If you prefer, open a private GitHub security advisory report on this repository
(**Security → Report a vulnerability**).

**Redact first.** Never send working tokens, session cookies, client secrets, certificates or
real tenant hostnames — describe them instead ("a bearer token in a response header" is enough
to reproduce).

## What to expect

- Acknowledgement within **7 days**.
- An honest status update while I investigate, and credit in the release notes if you want it.
- Coordinated disclosure: please give me a reasonable window to fix before publishing details.

Out of scope: issues in Microsoft services or in your own F&O tenant, social engineering,
and vulnerabilities that require already-compromised local access to the browser profile.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x (latest release) | ✅ |

Older versions are not patched retroactively — upgrade by re-downloading the release ZIP or
updating through the Chrome Web Store.

## Security design

The full threat model, permission boundaries and secret-handling rules live in
[`docs/SECURITY.md`](docs/SECURITY.md), which is also published at
<https://hassanfarooq235.github.io/fo-api-studio/security.html>.

Highlights:

- Manifest V3 with `script-src 'self'; object-src 'self'` — no remote code, ever.
- Minimal permissions: `sidePanel`, `storage`, `identity`; host access limited to
  `*.dynamics.com` and `login.microsoftonline.com`, everything else optional per origin.
- All outbound requests originate in the background service worker, so tokens never enter the
  rendered page.
- Server-provided data is escaped before display.
- No analytics, telemetry or third-party requests of any kind.
