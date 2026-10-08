# Contributing to F&O API Studio

Thanks for wanting to improve this. The project is deliberately small, dependency-free and
security-conscious — the rules below are what keep it that way, so please read them before
opening a pull request.

## Getting started

```sh
git clone https://github.com/hassanfarooq235/fo-api-studio.git
cd fo-api-studio
```

Load it in Chrome: **chrome://extensions → Developer mode → Load unpacked → select this folder.**

Then open the side panel from the extension's action button.

### Running the tests

```sh
# Unit suite (JavaScriptCore; ships with macOS)
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
  --module-file=tools/unit.test.js            # expect: ✓ all 100 assertions passed

# Browser suite (DOM + security assertions)
python3 tools/serve.py                        # http://127.0.0.1:8766
# then open http://127.0.0.1:8766/tools/browser.test.html   # expect: PASS 149
```

`tools/serve.py` also serves `tools/panel.preview.html`, a harness that renders the side panel
with fake data — useful for UI work without a Dynamics 365 tenant.

## Where things live

| Path | Role |
| --- | --- |
| `manifest.json` | MV3 manifest: permissions, host access, CSP |
| `src/background/service-worker.js` | Module service worker entry point |
| `src/background/auth.js` | All four auth modes (session, interactive PKCE, client credentials, manual) |
| `src/background/http.js` | **Every outbound request.** Tokens are attached here, outside the UI |
| `src/sidepanel/app.js` | Controller: state, drafts, snapshots, sending |
| `src/sidepanel/modules/` | `odata.js`, `webservice.js` (WSDL/SOAP), `response.js`, `curl.js`, `sendrules.js`, `gateway.js` (message bridge), `ui.js` |
| `src/shared/` | `url.js`, `variables.js` (`{{…}}` interpolation), `store.js`, `errors.js`, `constants.js` |
| `tools/` | Test suites, preview harness, icon and docs generators — **excluded from the store ZIP** |
| `docs/` | Store submission material: privacy policy, permission justifications, listing copy |

## Security invariants

These are not style preferences — a pull request that breaks any of them will be rejected, and
they are the reason the extension passes Chrome Web Store review.

1. **No remote code.** Never add `eval`, `new Function`, `setTimeout("string")`, inline
   `on…=` handlers, `<script src="https://…">`, dynamically constructed code, or any dependency
   that ships its own loader. The extension-page CSP stays exactly:
   `script-src 'self'; object-src 'self'`.
2. **Minimal permissions.** `sidePanel`, `storage`, `identity`, plus host access for
   `https://*.dynamics.com/*` and `https://login.microsoftonline.com/*`. Any new permission or
   host must come with an updated justification in
   [`docs/PERMISSIONS_JUSTIFICATION.md`](docs/PERMISSIONS_JUSTIFICATION.md) and a note in
   [`docs/SECURITY.md`](docs/SECURITY.md). Broad permissions (`<all_urls>`, `tabs`, `webRequest`,
   `scripting`, `cookies`, `downloads`) are not acceptable — there is always a narrower way.
3. **Secrets never reach the rendered page.** Client secrets, pasted bearer tokens and cached
   access tokens are read and written only by the background service worker. They must never
   appear in the DOM, in exports, in copied cURL commands, in history, in drafts, or in logs.
4. **Escape everything the server sent.** Response bodies, headers, `$metadata`, WSDL and error
   text are attacker-controlled input. Render them through the existing escaping helpers —
   never with raw `innerHTML`.
5. **Zero runtime dependencies.** No bundler, no framework, no CDN. If a change seems to need a
   dependency, it probably needs a smaller design.
6. **Tests travel with the change.** Every behavioural change adds assertions to
   `tools/unit.test.js` and/or `tools/browser.test.html`, and both suites stay green.

## Pull requests

- Small, single-purpose PRs are far easier to review than a big-bang branch.
- Fill in the pull request template — especially *How I tested*.
- UI changes should include a before/after screenshot (the preview harness makes these easy).
- New features should start as an issue so the approach can be discussed first. Look for the
  `good first issue` label if you want something well-scoped.
- Keep the store package clean: never commit `fo-api-studio.zip` (it is gitignored) and never
  commit real tenant URLs, tokens, client secrets or cookies — in code, tests, fixtures or
  screenshots.

## Reporting bugs

Open a bug report with the issue form. Please include the extension version, Chrome version,
auth mode and the *shape* of the failure — but **redact hostnames, tokens and response bodies**
first. Do not paste credentials into issues; the forms warn about this too.

Security-sensitive findings go to [`SECURITY.md`](SECURITY.md) instead of a public issue.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE), the same license that covers the rest of the project.
