## What changed

<!-- A sentence or two. Link the issue with "Closes #123" if there is one. -->

## Why

<!-- The problem this solves, or the user workflow it improves. -->

## How I tested

<!-- Be specific: which suite, what you observed in the panel, which Chrome version. -->

-

## Security checklist

Every pull request must keep these invariants — see [CONTRIBUTING.md](../CONTRIBUTING.md).

- [ ] No `eval`, `new Function`, string timers, inline handlers or remote scripts; the CSP is unchanged
      (`script-src 'self'; object-src 'self'`).
- [ ] No new permissions or host access — **or** `docs/PERMISSIONS_JUSTIFICATION.md` and
      `docs/SECURITY.md` were updated in this same PR.
- [ ] Secrets stay in the background service worker: not in the DOM, exports, cURL, history or logs.
- [ ] Server-provided data is escaped before rendering.
- [ ] No new runtime dependencies.

## Tests

- [ ] `tools/unit.test.js` passes (was **100** assertions)
- [ ] `tools/browser.test.html` passes (was **149** assertions)
- [ ] New behaviour is covered by new assertions (list them above or point at the lines)

## Housekeeping

- [ ] Docs updated where behaviour changed (`README.md`, `docs/…`)
- [ ] No real tenant URLs, tokens, secrets or cookies in code, fixtures or screenshots
- [ ] UI change includes a screenshot or short recording
