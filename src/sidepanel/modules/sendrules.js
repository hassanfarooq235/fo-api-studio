/**
 * Rules the panel applies to what actually goes on the wire, as opposed to
 * what the user sees in the editor.
 *
 * Two kinds of decision live here:
 *
 *  1. Headers the panel injects itself (SOAP `Content-Type`, `SOAPAction`) as
 *     opposed to headers the user typed. They are shown in the Headers tab
 *     while an envelope is being built — the request should stay inspectable —
 *     but they must not ride along into the next request: an OData PATCH that
 *     still carries `Content-Type: text/xml` is rejected by F&O, and a stale
 *     `SOAPAction` on a JSON call is noise at best.
 *  2. Whether a method may carry a body at all. The editor keeps whatever the
 *     user typed; only the send is affected.
 */

const sameName = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

/** Remove `auto` entries from `headers` (unchanged ones only). */
export function dropAutoHeaders(headers, auto = []) {
  if (!Array.isArray(auto) || !auto.length || !Array.isArray(headers)) {
    return { headers, changed: false };
  }
  const kept = headers.filter(
    (h) => !auto.some((a) => sameName(a.k, h.k) && String(a.v ?? '') === String(h.v ?? '')),
  );
  return { headers: kept, changed: kept.length !== headers.length };
}

/**
 * Add `auto` entries to `headers`, skipping names the user already defined.
 * Returns the entries actually added — those become the next `auto` list.
 */
export function injectAutoHeaders(headers, auto = []) {
  const added = [];
  if (!Array.isArray(auto) || !Array.isArray(headers)) return added;
  for (const { k, v } of auto) {
    if (headers.some((h) => sameName(h.k, k))) continue;
    headers.push({ k, v, on: true });
    added.push({ k, v });
  }
  return added;
}

/**
 * A payload on a GET or HEAD has no defined semantics (RFC 9110 §9.3.1), so
 * the body stays in the editor but is not transmitted — and no `Content-Type`
 * is invented for it. The cURL export has always followed this rule; the send
 * now does too, so both produce the same request.
 *
 * @param {string} method
 * @returns {boolean} true when a body may accompany this method
 */
export function methodSendsBody(method) {
  const m = String(method || 'GET').trim().toUpperCase();
  return m !== 'GET' && m !== 'HEAD';
}
