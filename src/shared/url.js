/**
 * Tiny URL helpers shared by the side panel and the background service worker.
 * Keep this dependency-free (no chrome.*, no DOM).
 */

const PLAIN_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;

/**
 * Origin of a URL-ish string — "scheme://host[:port]" — or '' when unusable.
 * Bare hosts ("contoso.operations.dynamics.com") are treated as https.
 *
 * The hostname is checked against a DNS-ish pattern because the WHATWG URL
 * parser happily accepts hosts that no resolver would, e.g. "https://not a
 * url !!" — such input must never compare equal to a real origin.
 */
export function originOf(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    // "[::1]" style IPv6 literals are valid, anything else must be DNS-ish.
    const host = String(u.hostname || '');
    const acceptable = host.startsWith('[') ? host.endsWith(']') : PLAIN_HOST.test(host);
    if (!acceptable) return '';
    return u.origin;
  } catch {
    return '';
  }
}

/** True when both inputs resolve to the same origin (and neither is junk). */
export function sameOrigin(a, b) {
  const oa = originOf(a);
  return Boolean(oa) && oa === originOf(b);
}
