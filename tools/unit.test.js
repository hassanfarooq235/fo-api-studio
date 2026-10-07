/**
 * Lightweight unit tests (no framework) — run with:
 *   jsc --module-file=tools/unit.test.js
 * Covers the pure logic: variable resolution, URL/body generators,
 * the custom-service contract generators and environment normalisation.
 */

const cryptoImpl = globalThis.crypto || {};
if (!cryptoImpl.randomUUID) {
  cryptoImpl.randomUUID = () => '00000000-0000-4000-8000-000000000000';
}
if (!cryptoImpl.getRandomValues) {
  cryptoImpl.getRandomValues = (arr) => {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    return arr;
  };
}
globalThis.crypto = cryptoImpl;

// jsc (the test runner) has no URL implementation; Chrome does. Provide a
// minimal one so normalizeUrl() can be exercised outside the browser.
if (typeof globalThis.URL === 'undefined') {
  globalThis.URL = class URLShim {
    constructor(input) {
      const m = /^(https?):\/\/([^/?#]+)([^?#]*)/i.exec(String(input));
      if (!m) throw new Error(`Invalid URL: ${input}`);
      const authority = m[2];
      const at = authority.lastIndexOf('@');
      const userinfo = at >= 0 ? authority.slice(0, at) : '';
      const host = authority.slice(at + 1).split(':')[0];
      if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error(`Invalid URL host: ${input}`);
      const q = String(input).indexOf('?');
      this.protocol = `${m[1].toLowerCase()}:`;
      this.origin = `${this.protocol}//${authority}`;
      this.hostname = host;
      this.username = userinfo ? userinfo.split(':')[0] : '';
      this.password = userinfo && userinfo.includes(':') ? userinfo.split(':')[1] : '';
      this.pathname = m[3] || '';
      this.search = q >= 0 ? String(input).slice(q) : '';
      this.hash = '';
      this.href = String(input);
    }
  };
}

const { resolveVars, resolveRequest, builtins } = await import('../src/shared/variables.js');
const { normalizeUrl } = await import('../src/background/envs.js');
const { originOf, sameOrigin } = await import('../src/shared/url.js');
const odata = await import('../src/sidepanel/modules/odata.js');
const ws = await import('../src/sidepanel/modules/webservice.js');

const out = globalThis.print || console.log.bind(console);

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failures.push(`${name}\n   expected: ${e}\n   actual:   ${a}`);
  }
}

/* ---------------- variables ---------------- */

const env = {
  baseUrl: 'https://contoso-uat.operations.dynamics.com',
  company: 'USMF',
  name: 'UAT',
  variables: [{ name: 'entity', value: 'CustomersV3' }],
};
const globals = [{ name: 'apiVersion', value: 'v1' }];

check(
  'builtins resolve',
  resolveVars('{{$baseUrl}}/data/{{entity}}?cmp={{$company}}', { env, globals }).text,
  'https://contoso-uat.operations.dynamics.com/data/CustomersV3?cmp=USMF',
);

check(
  'unknown variables are reported and left in place',
  resolveVars('{{nope}}/{{$company}}', { env, globals }),
  { text: '{{nope}}/USMF', missing: ['nope'] },
);

check('globals resolve', resolveVars('{{apiVersion}}', { env, globals }).text, 'v1');

check(
  'no placeholders => untouched',
  resolveVars('https://x.dynamics.com/data', { env, globals }),
  { text: 'https://x.dynamics.com/data', missing: [] },
);

check('$timestamp is numeric', /^\d{10}$/.test(builtins(env).$timestamp), true);
check('$guid is a uuid', builtins(env).$guid.length >= 32, true);

const resolvedReq = resolveRequest(
  {
    url: '{{$baseUrl}}/data/{{entity}}',
    params: [
      { k: '$top', v: '10', on: true },
      { k: '$skip', v: '5', on: false },
      { k: 'bad', v: '{{missingVar}}', on: true },
    ],
    headers: [{ k: 'Accept', v: 'application/json', on: true }],
    body: '{"a":"{{$company}}"}',
  },
  { env, globals },
);
check('request URL resolved', resolvedReq.url, 'https://contoso-uat.operations.dynamics.com/data/CustomersV3');
check('disabled params dropped', resolvedReq.params.length, 2);
check('missing var surfaced', resolvedReq.missing, ['missingVar']);
check('body resolved', resolvedReq.body, '{"a":"USMF"}');
check('headers resolved', resolvedReq.headers, [{ k: 'Accept', v: 'application/json' }]);

/* ---------------- environment URL ---------------- */

check('normalize full URL', normalizeUrl('https://a.dynamics.com/'), 'https://a.dynamics.com');
check('normalize bare host', normalizeUrl('a.operations.dynamics.com'), 'https://a.operations.dynamics.com');
check('normalize keeps path', normalizeUrl('https://host.example.com/foo/'), 'https://host.example.com/foo');
check('normalize rejects junk', normalizeUrl('not a url !!'), '');
check('normalize rejects spacey hosts', normalizeUrl('https://not a url !!'), '');
check('normalize rejects percent-encoded junk host', normalizeUrl('https://not%20a%20url%20!!'), '');
check('normalize rejects credentials', normalizeUrl('https://user:pass@host.example.com/'), '');
check('normalize rejects query strings', normalizeUrl('https://host.example.com/?mi=Foo'), '');
check('normalize keeps port', normalizeUrl('localhost:8080'), 'https://localhost:8080');

check('originOf bare host', originOf('contoso.operations.dynamics.com'), 'https://contoso.operations.dynamics.com');
check('originOf full URL', originOf('https://contoso.operations.dynamics.com/data/X'), 'https://contoso.operations.dynamics.com');
check('originOf keeps non-default port', originOf('https://localhost:8080/data'), 'https://localhost:8080');
check('originOf empty', originOf(''), '');
check('originOf rejects junk host', originOf('not a url !!'), '');
check('originOf rejects credentials-in-URL parsing junk', originOf('https://not%20a%20url%20!!'), '');
check('sameOrigin true', sameOrigin('https://a.example.com/data/X', 'a.example.com'), true);
check('sameOrigin false across hosts', sameOrigin('https://a.example.com', 'https://b.example.com'), false);
check('sameOrigin false for junk', sameOrigin('not a url !!', 'not a url !!'), false);

/* ---------------- OData generators ---------------- */

const detail = {
  setName: 'CustomersV3',
  typeName: 'CustomersV3',
  keys: ['CustomerAccount', 'RecId'],
  properties: [
    { name: 'CustomerAccount', type: 'Edm.String', nullable: false },
    { name: 'RecId', type: 'Edm.Int64', nullable: false },
    { name: 'OrganizationName', type: 'Edm.String', nullable: true },
    { name: 'SalesTaxGroup', type: 'Edm.String', nullable: true },
    { name: 'RowCount', type: 'Edm.Int32', nullable: true },
    { name: 'IsBlocked', type: 'Edm.Boolean', nullable: true },
    { name: 'PartyId', type: 'Edm.Guid', nullable: true },
  ],
  nav: ['Party'],
};

check(
  'key URL quotes strings and leaves numbers bare',
  odata.keyUrl('CustomersV3', detail, { CustomerAccount: '1001', RecId: '42' }),
  "{{$baseUrl}}/data/CustomersV3(CustomerAccount='1001', RecId=42)",
);

const keyUrl = odata.keyUrl('CustomersV3', detail, { CustomerAccount: "O'Brien", RecId: '42' });
check('key URL escaping', keyUrl, "{{$baseUrl}}/data/CustomersV3(CustomerAccount='O''Brien', RecId=42)");
check(
  'key URL without values falls back to the collection',
  odata.keyUrl('CustomersV3', detail, {}),
  '{{$baseUrl}}/data/CustomersV3',
);

const createBody = JSON.parse(odata.entityBody(detail, 'create'));
check('create body skips autogenerated key (RecId)', Object.keys(createBody).includes('RecId'), false);
check('create body keeps natural key', Object.keys(createBody).includes('CustomerAccount'), true);
check('create body has no nav properties', Object.keys(createBody).includes('Party'), false);
check('create body placeholders', createBody, {
  CustomerAccount: '',
  OrganizationName: '',
  SalesTaxGroup: '',
  RowCount: 0,
  IsBlocked: false,
  PartyId: '',
});

const updateBody = JSON.parse(odata.entityBody(detail, 'update'));
check('update body includes keys', Object.keys(updateBody).includes('RecId'), true);
check('collection URL', odata.collectionUrl('CustomersV3'), '{{$baseUrl}}/data/CustomersV3?cross-company=true&$top=25');

/* ---------------- custom service contract generators ---------------- */

const contract = {
  targetNs: 'http://contoso.dynamics.com/services/MyServiceGroup',
  service: 'MyService',
  operations: [
    {
      name: 'createCustomer',
      soapAction: 'http://contoso.dynamics.com/createCustomer',
      params: [
        { name: '_request', type: 'MyRequest', many: false, children: [
          { name: 'CustAccount', type: 'string', many: false, children: null },
          { name: 'DataAreaId', type: 'string', many: false, children: null },
          { name: 'IsBlocked', type: 'boolean', many: false, children: null },
        ] },
        { name: '_holdCodes', type: 'string', many: true, children: null },
      ],
      result: [{ name: 'return', type: 'string', many: false, children: null }],
    },
    {
      name: 'ping',
      soapAction: '',
      params: [],
      result: [],
    },
  ],
};

const skeleton = JSON.parse(ws.jsonSkeleton(contract.operations[0]));
check('json skeleton for wrapped params', skeleton, {
  _request: { CustAccount: '', DataAreaId: '', IsBlocked: false },
  _holdCodes: [''],
});

const skeletonTrim = JSON.parse(ws.jsonSkeleton(contract.operations[0], { trim: true }));
check('json skeleton with trimmed keys', Object.keys(skeletonTrim), ['request', 'holdCodes']);
check('json skeleton for empty operation', JSON.parse(ws.jsonSkeleton(contract.operations[1])), {});

const envelope = ws.soapEnvelope(contract.operations[0], contract.targetNs);
check(
  'envelope structure',
  [
    envelope.startsWith('<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:p="http://contoso.dynamics.com/services/MyServiceGroup">'),
    envelope.includes('    <p:createCustomer>'),
    envelope.includes('      <_request>'),
    envelope.includes('        <CustAccount></CustAccount>'),
    envelope.includes('      </_request>'),
    envelope.includes('    </p:createCustomer>'),
    envelope.endsWith('</soapenv:Envelope>'),
  ],
  [true, true, true, true, true, true, true],
);

check(
  'soap headers include the WSDL action',
  ws.soapHeaders(contract.operations[0]),
  { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"http://contoso.dynamics.com/createCustomer"' },
);
check('json service headers', ws.jsonServiceHeaders(), {
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

/* ---------------- cURL import ---------------- */

const { parseCurl, tokenizeCurl } = await import('../src/sidepanel/modules/curl.js');

check(
  'curl tokenizer honours quotes',
  tokenizeCurl(`curl -H 'A: b c' "https://x/y z"`),
  ['curl', '-H', 'A: b c', 'https://x/y z'],
);
check(
  'curl tokenizer joins backslash continuations',
  tokenizeCurl('curl \\\n  -X POST \\\n  https://x'),
  ['curl', '-X', 'POST', 'https://x'],
);
check('curl tokenizer keeps an empty quoted argument', tokenizeCurl(`curl -d '' https://x`), [
  'curl',
  '-d',
  '',
  'https://x',
]);

const cGet = parseCurl(
  `curl 'https://contoso.operations.dynamics.com/data/CustomersV3?$top=5' -H 'Accept: application/json' -H 'OData-Version: 4.0' --compressed -sS`,
);
check('import defaults to GET', cGet.method, 'GET');
check('import keeps the query string', cGet.url, 'https://contoso.operations.dynamics.com/data/CustomersV3?$top=5');
check(
  'import collects headers',
  cGet.headers,
  [
    { k: 'Accept', v: 'application/json', on: true },
    { k: 'OData-Version', v: '4.0', on: true },
  ],
);
check('import has no body by default', [cGet.body, cGet.bodyMode], ['', 'none']);
check('boolean flags produce no notes', cGet.notes, []);

const cPatch = parseCurl(
  `curl -X PATCH "https://contoso.operations.dynamics.com/data/CustomersV3(CustomerAccount='1001', dataAreaId='USMF')" -H 'Content-Type: application/json' --data-raw '{"OrganizationName":"Contoso"}'`,
);
check('explicit method wins', cPatch.method, 'PATCH');
check('json body detected', cPatch.bodyMode, 'json');
check('json body imported verbatim', cPatch.body, '{"OrganizationName":"Contoso"}');

const cPost = parseCurl('curl -H "A: b" -d a=1 -d b=2 https://x/api');
check('data implies POST', cPost.method, 'POST');
check('repeated --data is joined with &', cPost.body, 'a=1&b=2');
check('form-encoded body is text', cPost.bodyMode, 'text');

const cXml = parseCurl(`curl -X POST https://x/services -d '<a><b/></a>'`);
check('xml body detected', cXml.bodyMode, 'xml');

const cGetQ = parseCurl(`curl -G -d '$top=5' -d '$filter=Id gt 3' https://x/data/Things`);
check('-G moves data into params', cGetQ.method, 'GET');
check('-G params', cGetQ.params, [
  { k: '$top', v: '5', on: true },
  { k: '$filter', v: 'Id gt 3', on: true },
]);
check('-G leaves no body', cGetQ.body, '');

check('-I implies HEAD', parseCurl('curl -I https://x/data').method, 'HEAD');
check('attached method value', parseCurl('curl -XPOST https://x/api').method, 'POST');
check('combined short booleans do not hide the URL', parseCurl('curl -sSL https://x/api').url, 'https://x/api');
check('ignored flag value does not eat the URL', parseCurl('curl --max-time 30 https://x/api').url, 'https://x/api');
check('output flag value does not eat the URL', parseCurl('curl -o out.json https://x/api').url, 'https://x/api');

const cFile = parseCurl('curl --request POST --url https://x --header "H: v" --data-binary @payload.json');
check('a body read from a file is not imported', cFile.body, '');
check('…and the user is told', cFile.notes.some((n) => n.includes('file')), true);

const cAuth = parseCurl('curl -u admin:s3cret https://x/api');
check('command-line credentials are dropped', cAuth.headers, []);
check('dropped credentials are reported', cAuth.notes.some((n) => n.includes('credentials')), true);

const cForbidden = parseCurl(
  `curl https://x -H 'Host: contoso.dynamics.com' -H 'Content-Length: 12' -H 'Accept: */*'`,
);
check('browser-controlled headers are dropped', cForbidden.headers.map((h) => h.k), ['Accept']);

const cDup = parseCurl(`curl -H 'Accept: application/json' -H 'Accept: application/xml' https://x`);
check('duplicate headers keep the last value', cDup.headers.map((h) => h.v), ['application/xml']);

check('a suppressed header is ignored', parseCurl(`curl -H 'X-Trace;' https://x`).headers, []);

const cAuthHeader = parseCurl(`curl -H 'Authorization: Bearer abc' https://x`);
check('an imported Authorization header is kept', cAuthHeader.headers[0]?.v, 'Bearer abc');
check('…but flagged as better handled by Auth', cAuthHeader.notes.some((n) => n.includes('Auth tab')), true);

check('a redirect target is not mistaken for the URL', parseCurl('curl -s https://x > out.txt').url, 'https://x');
check('non-curl input is rejected', parseCurl('echo hi').error, 'The command must start with “curl”.');
check('empty input is rejected', parseCurl('').error, 'Paste a curl command first.');
check('a command without a URL is rejected', typeof parseCurl('curl -X GET').error, 'string');
check('a missing flag value is reported', parseCurl('curl --header').error, '--header needs a value.');

/* ---------------- what actually goes on the wire ---------------- */

const { dropAutoHeaders, injectAutoHeaders, methodSendsBody } = await import('../src/sidepanel/modules/sendrules.js');

const SOAP_CT = 'text/xml; charset=utf-8';
const SOAP_ACTION = '"http://contoso.dynamics.com/createCustomer"';
const soapAuto = [
  { k: 'Content-Type', v: SOAP_CT },
  { k: 'SOAPAction', v: SOAP_ACTION },
];
const mixedHeaders = [
  { k: 'Accept', v: 'application/json', on: true },
  { k: 'Content-Type', v: SOAP_CT, on: true },
  { k: 'SOAPAction', v: SOAP_ACTION, on: true },
];

const dropped = dropAutoHeaders(mixedHeaders, soapAuto);
check('injected SOAP headers leave with the request type', dropped.headers.map((h) => h.k), ['Accept']);
check('…and the removal is reported', dropped.changed, true);
check('the original list is not mutated', mixedHeaders.length, 3);

const edited = [
  { k: 'Content-Type', v: 'application/json', on: true },
  { k: 'SOAPAction', v: SOAP_ACTION, on: true },
];
const kept = dropAutoHeaders(edited, soapAuto);
check('a header the user edited survives the cleanup', kept.headers.map((h) => h.k), ['Content-Type']);
check('…while the untouched injected one still goes', kept.changed, true);

check('without a recorded list nothing is touched', dropAutoHeaders(edited, []).changed, false);
check('a missing list is safe', dropAutoHeaders(edited).changed, false);

const caseDropped = dropAutoHeaders([{ k: 'content-type', v: SOAP_CT }], soapAuto);
check('header names compare case-insensitively', caseDropped.changed, true);

const target = [];
const added = injectAutoHeaders(target, soapAuto);
check('the panel injects the headers it needs', target.length, 2);
check('…and reports exactly what it added', added.length, 2);

target.push({ k: 'content-type', v: 'application/json; charset=utf-8', on: true });
const skipped = injectAutoHeaders(target, soapAuto);
check('a same-named header the user already set wins', skipped.length, 0);
check('…and is left untouched', target.length, 3);

check('GET carries no body', methodSendsBody('GET'), false);
check('HEAD carries no body', methodSendsBody('HEAD'), false);
check('POST carries a body', methodSendsBody('POST'), true);
check('PATCH carries a body', methodSendsBody('PATCH'), true);
check('method case and padding do not matter', [methodSendsBody(' get '), methodSendsBody('Delete')], [false, true]);
check('a missing method is read as GET', [methodSendsBody(''), methodSendsBody()], [false, false]);
check('any other method keeps its body', methodSendsBody('OPTIONS'), true);

/* ---------------- result ---------------- */

if (failures.length) {
  out(`✗ ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) out(`  - ${f}`);
  throw new Error(`${failures.length} test(s) failed`);
}
out(`✓ all ${passed} assertions passed`);
