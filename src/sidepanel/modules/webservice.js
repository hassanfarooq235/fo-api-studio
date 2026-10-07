/**
 * Custom web service helpers.
 *
 * F&O deploys every service group twice:
 *   - JSON  : POST {{$baseUrl}}/api/services/{group}/{service}/{operation}
 *   - SOAP  : POST {{$baseUrl}}/soap/services/{service}
 *
 * The SOAP endpoint publishes a WSDL that describes the very same data
 * contracts, so we parse it to generate request bodies and SOAP envelopes.
 */

import { httpSend } from './gateway.js';

const XSD_NS_HINT = /^(string|char|guid|longString|anyUri|name|label|text|enumeration)$/i;

/** How many times an array/collection member is emitted in generated templates. */
const ARRAY_TEMPLATE_ITEMS = 2;

function all(root, localName) {
  return Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === localName);
}

function attr(el, name) {
  if (!el) return null;
  for (const a of el.attributes) {
    if (a.localName === name || a.name === name) return a.value;
  }
  return null;
}

function localNameOfQName(qname) {
  return String(qname || '').split(':').pop();
}

function closestComplexType(el, stopAt) {
  let node = el.parentElement;
  while (node && node !== stopAt.parentElement) {
    if (node.localName === 'complexType') return node;
    if (node === stopAt) return null;
    node = node.parentElement;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * WSDL fetching
 * ------------------------------------------------------------------ */

export async function fetchContract(env, serviceName) {
  const name = String(serviceName || '').trim();
  if (!env?.baseUrl) throw new Error('Select an environment first.');
  if (!name) throw new Error('Enter the service name (the name of the service, e.g. MyService).');

  const url = `${env.baseUrl.replace(/\/+$/, '')}/soap/services/${encodeURIComponent(name)}?wsdl`;
  const res = await httpSend({
    url,
    method: 'GET',
    headers: { Accept: 'application/xml, text/xml, */*' },
    timeoutMs: 45000,
    auth: { envId: env.id },
  });
  if (!res.ok) throw new Error(res.error.message);

  const r = res.response;
  if (r.status >= 400) {
    throw new Error(
      `WSDL request returned HTTP ${r.status} ${r.statusText}. Check the service name and that the service group is deployed.`,
    );
  }

  const doc = new DOMParser().parseFromString(r.bodyText, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('The response is not valid XML — this does not look like a WSDL document.');
  }

  const contract = parseWsdl(doc);
  if (!contract.operations.length) throw new Error('No operations were found in the WSDL.');
  return contract;
}

/* ------------------------------------------------------------------ *
 * WSDL parsing
 * ------------------------------------------------------------------ */

export function parseWsdl(doc) {
  const schemas = all(doc, 'schema');
  const elements = {};
  const types = {};

  for (const sc of schemas) {
    for (const child of Array.from(sc.children)) {
      const name = attr(child, 'name');
      if (!name) continue;
      if (child.localName === 'element') elements[name] = child;
      if (child.localName === 'complexType' || child.localName === 'simpleType') types[name] = child;
    }
  }

  const targetNs = attr(schemas[0], 'targetNamespace') || '';

  const messages = {};
  for (const m of all(doc, 'message')) {
    messages[attr(m, 'name')] = Array.from(m.children)
      .filter((c) => c.localName === 'part')
      .map((p) => ({
        name: attr(p, 'name'),
        element: attr(p, 'element'),
        type: attr(p, 'type'),
      }));
  }

  // SOAP action values come from the binding. <soap:operation> carries the
  // action but not the name — the name lives on the parent <wsdl:operation>.
  const soapActions = {};
  for (const op of all(doc, 'operation')) {
    const action = attr(op, 'soapAction');
    if (action === null) continue;
    const name = attr(op, 'name') || attr(op.parentElement, 'name');
    if (name) soapActions[name] = action;
  }

  const operations = [];
  const seen = new Set();
  for (const pt of all(doc, 'portType')) {
    for (const op of Array.from(pt.children).filter((c) => c.localName === 'operation')) {
      const name = attr(op, 'name');
      if (!name || seen.has(name)) continue;
      seen.add(name);

      const inputEl = Array.from(op.children).find((c) => c.localName === 'input');
      const outputEl = Array.from(op.children).find((c) => c.localName === 'output');

      operations.push({
        name,
        params: paramsFromMessageRef(inputEl, messages, elements, types),
        result: paramsFromMessageRef(outputEl, messages, elements, types),
        soapAction: Object.prototype.hasOwnProperty.call(soapActions, name) ? soapActions[name] : null,
      });
    }
  }

  return { targetNs, operations, service: attr(all(doc, 'service')[0], 'name') || '' };
}

function paramsFromMessageRef(msgRefEl, messages, elements, types) {
  if (!msgRefEl) return [];
  const msgName = localNameOfQName(attr(msgRefEl, 'message'));
  const parts = messages[msgName] || [];
  const params = [];

  for (const part of parts) {
    if (part.element) {
      const elName = localNameOfQName(part.element);
      const el = elements[elName];
      if (el) {
        const kids = childrenOfElement(el, types, 0);
        if (kids.length) {
          // Wrapped document/literal: children of the wrapper ARE the parameters.
          params.push(...kids);
          continue;
        }
        const typeAttr = attr(el, 'type');
        const isComplex =
          Array.from(el.children).some((c) => c.localName === 'complexType') ||
          Boolean(typeAttr && types[localNameOfQName(typeAttr)]?.localName === 'complexType');
        if (isComplex) continue; // empty complex wrapper => operation takes no parameters
        params.push({ name: elName, type: typeAttr ? localNameOfQName(typeAttr) : '', many: false, children: null });
        continue;
      }
      params.push({ name: elName, type: '', many: false, children: null });
    } else if (part.type) {
      const typeName = localNameOfQName(part.type);
      const kids = childrenOfType(typeName, types, 0);
      if (kids && kids.length) params.push(...kids);
      else params.push({ name: part.name, type: typeName, many: false, children: null });
    }
  }
  return params;
}

function childrenOfElement(el, types, depth) {
  if (depth > 6) return [];
  const inline = Array.from(el.children).find((c) => c.localName === 'complexType');
  if (inline) return sequenceChildren(inline, types, depth + 1);
  const t = attr(el, 'type');
  if (!t) return [];
  return childrenOfType(localNameOfQName(t), types, depth + 1) || [];
}

function childrenOfType(typeName, types, depth) {
  if (depth > 6) return null;
  const def = types[typeName];
  if (!def || def.localName !== 'complexType') return null;
  return sequenceChildren(def, types, depth + 1);
}

function sequenceChildren(complexTypeEl, types, depth) {
  const out = [];
  for (const e of Array.from(complexTypeEl.getElementsByTagName('*'))) {
    if (e.localName !== 'element') continue;
    if (closestComplexType(e, complexTypeEl) !== complexTypeEl) continue;
    const p = toParam(e, types, depth);
    if (p) out.push(p);
  }
  return out;
}

function toParam(el, types, depth) {
  const name = attr(el, 'name');
  if (!name) return null;
  const maxRaw = attr(el, 'maxOccurs');
  const many = maxRaw === 'unbounded' || Number(maxRaw) > 1;

  const typeAttr = attr(el, 'type');
  let children = null;
  if (depth <= 6) {
    const inline = Array.from(el.children).find((c) => c.localName === 'complexType');
    if (inline) children = sequenceChildren(inline, types, depth + 1);
    else if (typeAttr) children = childrenOfType(localNameOfQName(typeAttr), types, depth + 1);
  }
  return { name, type: typeAttr ? localNameOfQName(typeAttr) : '', many, children };
}

/* ------------------------------------------------------------------ *
 * Generators
 * ------------------------------------------------------------------ */

function keyOf(param, trim) {
  return trim && param.name.startsWith('_') ? param.name.slice(1) : param.name;
}

function scalarPlaceholder(type) {
  const t = String(type || '');
  if (XSD_NS_HINT.test(t)) return '';
  if (/^(u?int|long|short|byte)/i.test(t)) return 0;
  if (/decimal|double|float|real/i.test(t)) return 0;
  if (/bool/i.test(t)) return false;
  if (/date|time/i.test(t)) return '2026-01-01T00:00:00Z';
  return '';
}

function placeholder(param, depth, trim) {
  if (depth > 6) return null;
  if (param.many) return [placeholder({ ...param, many: false }, depth + 1, trim)];
  if (param.children && param.children.length) {
    const obj = {};
    for (const c of param.children) obj[keyOf(c, trim)] = placeholder(c, depth + 1, trim);
    return obj;
  }
  return scalarPlaceholder(param.type);
}

/** JSON body for the /api/services/... endpoint, keyed by method parameter names. */
export function jsonSkeleton(operation, { trim = false } = {}) {
  const out = {};
  for (const p of operation?.params || []) {
    out[keyOf(p, trim)] = placeholder(p, 0, trim);
  }
  return JSON.stringify(out, null, 2);
}

function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderParam(param, depth, trim) {
  const pad = '  '.repeat(3 + depth);
  const tag = keyOf(param, trim);
  if (depth > 6) return `${pad}<${tag}/>\n`;

  const single = () => {
    if (param.children && param.children.length) {
      const kids = param.children.map((c) => renderParam(c, depth + 1, trim)).join('');
      return `${pad}<${tag}>\n${kids}${pad}</${tag}>\n`;
    }
    return `${pad}<${tag}>${xmlEscape(scalarText(param.type))}</${tag}>\n`;
  };

  if (param.many) {
    // Repeated sibling elements are how SOAP document/literal represents arrays.
    return Array.from({ length: ARRAY_TEMPLATE_ITEMS }, single).join('');
  }
  return single();
}

function scalarText(type) {
  return String(scalarPlaceholder(type));
}

/** SOAP 1.1 envelope for an operation (uses the contract's target namespace). */
export function soapEnvelope(operation, targetNs, { trim = false } = {}) {
  const SOAP = 'http://schemas.xmlsoap.org/soap/envelope/';
  const parts = (operation?.params || []).map((p) => renderParam(p, 0, trim)).join('');

  return [
    `<soapenv:Envelope xmlns:soapenv="${SOAP}" xmlns:p="${xmlEscape(targetNs || '')}">`,
    '  <soapenv:Body>',
    `    <p:${operation.name}>`,
    parts.trimEnd(),
    `    </p:${operation.name}>`,
    '  </soapenv:Body>',
    '</soapenv:Envelope>',
  ].join('\n');
}

/** Headers required to call the JSON endpoint. */
export function jsonServiceHeaders() {
  return { 'Content-Type': 'application/json', Accept: 'application/json' };
}

/** Headers required for a SOAP 1.1 call. */
export function soapHeaders(operation) {
  const headers = { 'Content-Type': 'text/xml; charset=utf-8' };
  if (operation?.soapAction !== null && operation?.soapAction !== undefined) {
    headers.SOAPAction = `"${operation.soapAction}"`;
  }
  return headers;
}
