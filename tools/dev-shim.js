/**
 * DEV-ONLY chrome.* shim so the side panel can be opened outside the extension
 * (via tools/panel.preview.html) for visual review and screenshots.
 *
 * This file is NOT imported by any extension code — production code always
 * talks to the real chrome.* APIs.
 */

// Backed by localStorage so persistence (environments, drafts, history) can be
// exercised in the preview, exactly as chrome.storage.local behaves in the
// real extension. Append ?reset to the preview URL to start clean.
const STORE_KEY = 'fo-api-studio.preview';

function loadMem() {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    return new PersistentMap(raw ? Object.entries(JSON.parse(raw)) : []);
  } catch {
    return new PersistentMap();
  }
}

function persistMem(map) {
  try {
    globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    // quota or private mode — the preview still works, just without memory
  }
}

class PersistentMap extends Map {
  set(key, value) {
    const out = super.set(key, value);
    persistMem(this);
    return out;
  }
  delete(key) {
    const out = super.delete(key);
    persistMem(this);
    return out;
  }
}

const mem = loadMem();

// Static (not top-level-await) import so this module finishes evaluating
// BEFORE app.js runs — module scripts execute in document order.
import { normalizeUrl } from '../src/background/envs.js';

const SEED_ENV = {
  id: 'env-dev',
  name: 'UAT (demo)',
  baseUrl: 'https://contoso-uat.operations.dynamics.com',
  company: 'USMF',
  variables: [{ name: 'entity', value: 'CustomersV3', secret: false }],
  auth: { mode: 'session', tenantId: '', clientId: '', scope: '', hasSecret: false, hasToken: false },
};

const META_XML = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="Contoso" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="CustomersV3">
        <Key><PropertyRef Name="CustomerAccount"/><PropertyRef Name="dataAreaId"/></Key>
        <Property Name="CustomerAccount" Type="Edm.String" Nullable="false"/>
        <Property Name="dataAreaId" Type="Edm.String" Nullable="false"/>
        <Property Name="RecId" Type="Edm.Int64" Nullable="false"/>
        <Property Name="OrganizationName" Type="Edm.String"/>
        <Property Name="SalesTaxGroup" Type="Edm.String"/>
        <Property Name="IsBlocked" Type="Edm.Boolean"/>
        <NavigationProperty Name="Party" Type="Contoso.PartyV2"/>
      </EntityType>
      <Action Name="IncreaseCreditLimit" IsBound="true">
        <Parameter Name="bindingParameter" Type="Contoso.CustomersV3"/>
        <Parameter Name="amount" Type="Edm.Decimal"/>
        <Parameter Name="notify" Type="Edm.Boolean" IsOptional="true"/>
        <ReturnType Type="Edm.Boolean"/>
      </Action>
      <Function Name="Ping">
        <Parameter Name="echo" Type="Edm.String" IsOptional="true"/>
        <ReturnType Type="Edm.String"/>
      </Function>
      <Action Name="RecalculateAll">
        <Parameter Name="company" Type="Edm.String"/>
      </Action>
      <EntityType Name="SalesOrderHeadersV2">
        <Key><PropertyRef Name="SalesOrderNumber"/><PropertyRef Name="dataAreaId"/></Key>
        <Property Name="SalesOrderNumber" Type="Edm.String" Nullable="false"/>
        <Property Name="dataAreaId" Type="Edm.String" Nullable="false"/>
        <Property Name="OrderedCustomerAccount" Type="Edm.String"/>
        <Property Name="RequestedReceiptDate" Type="Edm.DateTimeOffset"/>
      </EntityType>
      <EntityContainer Name="EntityContainer">
        <EntitySet Name="CustomersV3" EntityType="Contoso.CustomersV3"/>
        <EntitySet Name="SalesOrderHeadersV2" EntityType="Contoso.SalesOrderHeadersV2"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

const WSDL_XML = `<?xml version="1.0" encoding="utf-8"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
                  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
                  xmlns:s="http://www.w3.org/2001/XMLSchema"
                  xmlns:tns="http://contoso.dynamics.com/services/MyServiceGroup"
                  targetNamespace="http://contoso.dynamics.com/services/MyServiceGroup">
  <wsdl:types>
    <s:schema elementFormDefault="qualified" targetNamespace="http://contoso.dynamics.com/services/MyServiceGroup">
      <s:complexType name="CreateCustomerRequest">
        <s:sequence>
          <s:element name="CustAccount" type="s:string"/>
          <s:element name="OrganizationName" type="s:string"/>
          <s:element name="DataAreaId" type="s:string"/>
          <s:element name="CreditLimit" type="s:decimal"/>
          <s:element name="IsBlocked" type="s:boolean"/>
          <s:element name="Party" type="tns:PartyInfo" nillable="true"/>
        </s:sequence>
      </s:complexType>
      <s:complexType name="PartyInfo">
        <s:sequence>
          <s:element name="Name" type="s:string"/>
          <s:element name="Phone" type="s:string"/>
        </s:sequence>
      </s:complexType>
      <s:element name="createCustomer">
        <s:complexType>
          <s:sequence>
            <s:element name="_request" type="tns:CreateCustomerRequest"/>
            <s:element name="_holdCodes" type="s:string" minOccurs="0" maxOccurs="unbounded"/>
          </s:sequence>
        </s:complexType>
      </s:element>
      <s:element name="createCustomerResponse">
        <s:complexType><s:sequence><s:element name="return" type="s:string" nillable="true"/></s:sequence></s:complexType>
      </s:element>
      <s:element name="ping"><s:complexType><s:sequence/></s:complexType></s:element>
      <s:element name="pingResponse">
        <s:complexType><s:sequence><s:element name="return" type="s:string" nillable="true"/></s:sequence></s:complexType>
      </s:element>
    </s:schema>
  </wsdl:types>
  <wsdl:message name="pingSoapIn"><wsdl:part name="parameters" element="tns:ping"/></wsdl:message>
  <wsdl:message name="pingSoapOut"><wsdl:part name="parameters" element="tns:pingResponse"/></wsdl:message>
  <wsdl:message name="createCustomerSoapIn"><wsdl:part name="parameters" element="tns:createCustomer"/></wsdl:message>
  <wsdl:message name="createCustomerSoapOut"><wsdl:part name="parameters" element="tns:createCustomerResponse"/></wsdl:message>
  <wsdl:portType name="MyServicePort">
    <wsdl:operation name="ping">
      <wsdl:input message="tns:pingSoapIn"/><wsdl:output message="tns:pingSoapOut"/>
    </wsdl:operation>
    <wsdl:operation name="createCustomer">
      <wsdl:input message="tns:createCustomerSoapIn"/><wsdl:output message="tns:createCustomerSoapOut"/>
    </wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="MyServiceBinding" type="tns:MyServicePort">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http" style="document"/>
    <wsdl:operation name="ping"><soap:operation soapAction="" style="document"/></wsdl:operation>
    <wsdl:operation name="createCustomer"><soap:operation soapAction="http://contoso.dynamics.com/createCustomer" style="document"/></wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="MyService">
    <wsdl:port name="MyServicePort" binding="tns:MyServiceBinding">
      <soap:address location="https://contoso-uat.operations.dynamics.com/soap/services/MyService"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;

const DEMO_ROWS = [
  { CustomerAccount: '1001', OrganizationName: 'Contoso Ltd', dataAreaId: 'USMF', IsBlocked: false, SalesTaxGroup: 'GST' },
  { CustomerAccount: '1002', OrganizationName: 'Fabrikam Residences', dataAreaId: 'USMF', IsBlocked: true, SalesTaxGroup: 'GST' },
  { CustomerAccount: '1003', OrganizationName: 'Adventure Works', dataAreaId: 'DEMF', IsBlocked: false, SalesTaxGroup: 'VAT' },
];

async function background(msg) {
  const p = msg.payload || {};
  await new Promise((r) => setTimeout(r, 120)); // simulate latency

  switch (msg.type) {
    case 'env.list': {
      const stored = mem.get('envs');
      const envs = stored || [SEED_ENV];
      return { ok: true, envs, activeEnvId: mem.get('activeEnvId') || envs[0]?.id || null };
    }

    case 'env.save': {
      const baseUrl = normalizeUrl(p.baseUrl);
      if (!baseUrl) {
        return {
          ok: false,
          error: { kind: 'input', message: 'Base URL must be a valid http(s) URL, e.g. https://contoso.operations.dynamics.com' },
        };
      }
      if (!String(p.name || '').trim()) {
        return { ok: false, error: { kind: 'input', message: 'Environment name is required.' } };
      }
      const envs = mem.get('envs') || [SEED_ENV];
      const id = p.id || `env-${envs.length + 1}`;
      const saved = {
        ...p,
        baseUrl,
        id,
        auth: {
          mode: p.auth?.mode || 'session',
          tenantId: p.auth?.tenantId || '',
          clientId: p.auth?.clientId || '',
          scope: p.auth?.scope || '',
          hasSecret: Boolean(p.auth?.clientSecret),
          hasToken: Boolean(p.auth?.manualToken),
        },
      };
      const idx = envs.findIndex((e) => e.id === id);
      if (idx >= 0) envs[idx] = saved;
      else envs.push(saved);
      mem.set('envs', envs);
      if (!mem.get('activeEnvId')) mem.set('activeEnvId', id);
      return { ok: true, env: saved };
    }

    case 'env.delete': {
      const envs = (mem.get('envs') || [SEED_ENV]).filter((e) => e.id !== p.id);
      mem.set('envs', envs);
      if (mem.get('activeEnvId') === p.id) mem.set('activeEnvId', envs[0]?.id || null);
      return { ok: true };
    }

    case 'env.active.set':
      mem.set('activeEnvId', p.id);
      return { ok: true };

    case 'env.active.get':
      return { ok: true, activeEnvId: mem.get('activeEnvId') || SEED_ENV.id };

    case 'auth.status': {
      const envs = mem.get('envs') || [SEED_ENV];
      const env = envs.find((e) => e.id === p.id)
        || envs.find((e) => e.id === mem.get('activeEnvId'))
        || SEED_ENV;
      const mode = env.auth?.mode || 'session';
      if (mode === 'session') {
        return { ok: true, status: { mode, ready: true, note: 'Uses your signed-in browser session for this environment.' } };
      }
      if (mode === 'manual') {
        const has = Boolean(env.auth?.manualToken);
        return { ok: true, status: { mode, ready: has, note: has ? 'Using a pasted bearer token.' : 'No bearer token saved yet.' } };
      }
      const until = new Date(Date.now() + 3600_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return { ok: true, status: { mode, ready: true, note: `Token valid until ${until} (demo).` } };
    }

    case 'auth.signin':
      return { ok: true, status: { mode: 'interactive', ready: true, note: 'Signed in (demo).' } };

    case 'auth.token':
      if (p.reveal) return { ok: true, token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.demo.payload' };
      return { ok: true, note: 'Token fetched and cached in the background process.', status: { mode: 'clientCredentials', ready: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() } };

    case 'auth.inspect':
      return {
        ok: true,
        claims: {
          aud: 'https://contoso-uat.operations.dynamics.com',
          tid: '00000000-0000-0000-0000-000000000000',
          scp: 'user_impersonation',
          exp: new Date(Date.now() + 3600_000).toISOString(),
          preferred_username: 'dev@contoso.onmicrosoft.com',
          _expired: false,
        },
        problems: [],
      };

    case 'http.send': {
      const url = String(p.url || '');
      const isXml = String(p.headers?.['Content-Type'] || '').includes('xml');
      if (url.includes('wsdl')) {
        return {
          ok: true,
          response: {
            status: 200, statusText: 'OK',
            headers: { 'content-type': 'text/xml;charset=utf-8' },
            bodyText: WSDL_XML, timeMs: 187, sizeBytes: WSDL_XML.length, finalUrl: url,
          },
        };
      }
      if (url.includes('$metadata')) {
        return {
          ok: true,
          response: {
            status: 200, statusText: 'OK',
            headers: { 'content-type': 'application/xml;charset=utf-8', 'odata-version': '4.0' },
            bodyText: META_XML, timeMs: 318, sizeBytes: META_XML.length, finalUrl: url,
          },
        };
      }
      if (isXml) {
        const soapResponse = [
          '<?xml version="1.0" encoding="utf-8"?>',
          '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">',
          '  <soapenv:Body>',
          '    <createCustomerResponse xmlns="http://contoso.dynamics.com/services/MyServiceGroup">',
          '      <return>CUST-0001</return>',
          '    </createCustomerResponse>',
          '  </soapenv:Body>',
          '</soapenv:Envelope>',
        ].join('\n');
        return {
          ok: true,
          response: {
            status: 200, statusText: 'OK',
            headers: { 'content-type': 'text/xml;charset=utf-8', 'x-ms-dynamics-ax-requestid': '8f1a2b3c-0000-4000-8000-1234567890ab' },
            bodyText: soapResponse, timeMs: 233, sizeBytes: soapResponse.length, finalUrl: url,
          },
        };
      }
      // OData collection: page 1 carries a continuation link so the "Next page"
      // flow can be exercised in the preview; page 2 (a $skiptoken request) does not.
      const page2 = url.includes('$skiptoken');
      const root = url.split('?')[0];
      const payload = {
        '@odata.context': `${root}#CustomersV3`,
        value: page2
          ? DEMO_ROWS.map((r) => ({ ...r, CustomerAccount: String(Number(r.CustomerAccount) + 3) }))
          : DEMO_ROWS,
      };
      if (!page2) payload['@odata.nextLink'] = `${root}?cross-company=true&$top=25&$skiptoken=25`;
      const bodyText = JSON.stringify(payload, null, 0);
      return {
        ok: true,
        response: {
          status: 200, statusText: 'OK',
          headers: { 'content-type': 'application/json; odata.metadata=minimal', 'odata-version': '4.0', 'x-ms-dynamics-ax-requestid': '8f1a2b3c-0000-4000-8000-1234567890ab' },
          bodyText, timeMs: 142, sizeBytes: bodyText.length, finalUrl: url,
        },
      };
    }

    default:
      return { ok: false, error: { kind: 'internal', message: `dev shim: unhandled ${msg.type}` } };
  }
}

globalThis.chrome = {
  runtime: {
    id: 'preview-extension-id',
    sendMessage: (msg) => Promise.resolve(background(msg)),
    onMessage: { addListener() {} },
    onInstalled: { addListener() {} },
  },
  storage: {
    local: {
      get: (key) => {
        if (typeof key === 'string') return Promise.resolve({ ...(mem.has(key) ? { [key]: mem.get(key) } : {}) });
        if (Array.isArray(key)) {
          const out = {};
          for (const k of key) if (mem.has(k)) out[k] = mem.get(k);
          return Promise.resolve(out);
        }
        if (key && typeof key === 'object') {
          const out = {};
          for (const [k, v] of Object.entries(key)) out[k] = mem.has(k) ? mem.get(k) : v;
          return Promise.resolve(out);
        }
        return Promise.resolve(Object.fromEntries(mem));
      },
      set: (obj) => {
        for (const [k, v] of Object.entries(obj)) mem.set(k, v);
        return Promise.resolve();
      },
      remove: (key) => {
        for (const k of Array.isArray(key) ? key : [key]) mem.delete(k);
        return Promise.resolve();
      },
    },
  },
  permissions: {
    contains: () => Promise.resolve(true),
    request: () => Promise.resolve(true),
  },
  tabs: {
    query: () =>
      Promise.resolve([
        { url: 'https://contoso-uat.operations.dynamics.com/?mi=CustCustomersV3&cmp=USMF', title: 'Customers' },
      ]),
  },
  sidePanel: { setPanelBehavior: () => Promise.resolve() },
  identity: { launchWebAuthFlow: () => Promise.reject(new Error('preview only')) },
};

console.info('[dev shim] chrome.* stubbed for preview');
