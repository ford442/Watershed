/**
 * Unit tests for verify_deploy.mjs. No network: every fetch is a stub.
 */
import {
  DEFAULT_BASE_URL,
  commitMatches,
  evaluate,
  extractAssetRefs,
  isIdentityEncoding,
  normalizeBaseUrl,
  parseArgs,
  verifyDeploy,
} from './verify_deploy.mjs';

const IDENTITY = {
  schema: 1,
  commit: 'c4c1ab3ca958c1230525a15c612ebb0346e5c4af',
  commitShort: 'c4c1ab3',
  dirty: false,
  builtAt: '2026-09-09T12:00:00.000Z',
  wasmStamp: '48807a27dda538ad',
  glueFile: 'watershed_native.js',
  wasmFile: 'watershed_native.wasm',
  glueBytes: 33562,
  wasmBytes: 33811,
};

const INDEX_HTML = `<!doctype html><html><head>
  <script type="module" crossorigin src="./assets/index-8Gl23hpQ.js"></script>
  <link rel="modulepreload" crossorigin href="./assets/vendor-three-DnVXDa-U.js">
  <link rel="stylesheet" crossorigin href="./assets/index-DcVwaCkX.css">
  <link rel="icon" href="https://example.com/favicon.ico">
</head><body><div id="root"></div></body></html>`;

/** Minimal server stub: paths → { status, body, bytes }. */
function serverStub(routes) {
  return async (url, init = {}) => {
    const path = new URL(url).pathname.split('/').pop();
    const route = routes[path];
    if (!route) return { ok: false, status: 404, text: async () => '', headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      ok: route.status === 200,
      status: route.status,
      text: async () => route.body ?? '',
      headers: { get: (name) => (name === 'content-length' && route.bytes != null ? String(route.bytes) : null) },
      arrayBuffer: async () => new ArrayBuffer(route.bytes ?? 0),
      _method: init.method,
    };
  };
}

const HEALTHY = {
  'build-identity.json': { status: 200, body: JSON.stringify(IDENTITY) },
  'index.html': { status: 200, body: INDEX_HTML },
  'index-8Gl23hpQ.js': { status: 200, bytes: 887468 },
  'vendor-three-DnVXDa-U.js': { status: 200, bytes: 1068710 },
  'index-DcVwaCkX.css': { status: 200, bytes: 4321 },
  'watershed_native.js': { status: 200, bytes: 33562 },
  'watershed_native.wasm': { status: 200, bytes: 33811 },
};

describe('normalizeBaseUrl', () => {
  it('defaults to the deploy target', () => {
    expect(normalizeBaseUrl(undefined)).toBe(DEFAULT_BASE_URL);
    expect(normalizeBaseUrl('')).toBe(DEFAULT_BASE_URL);
  });

  it('adds a trailing slash and a scheme', () => {
    expect(normalizeBaseUrl('https://test.1ink.us/watershed')).toBe('https://test.1ink.us/watershed/');
    expect(normalizeBaseUrl('test.1ink.us/watershed/')).toBe('https://test.1ink.us/watershed/');
  });
});

describe('parseArgs', () => {
  it('takes a positional base url', () => {
    expect(parseArgs(['http://127.0.0.1:4173']).baseUrl).toBe('http://127.0.0.1:4173/');
  });

  it('reads --expect in both spellings', () => {
    expect(parseArgs(['--expect', 'c4c1ab3']).expect).toBe('c4c1ab3');
    expect(parseArgs(['--expect=c4c1ab3']).expect).toBe('c4c1ab3');
  });

  it('defaults to the live URL with no expectation', () => {
    expect(parseArgs([])).toEqual({ baseUrl: DEFAULT_BASE_URL, expect: null, json: false });
  });
});

describe('extractAssetRefs', () => {
  it('finds scripts, modulepreloads and stylesheets', () => {
    expect(extractAssetRefs(INDEX_HTML)).toEqual([
      'assets/index-8Gl23hpQ.js',
      'assets/vendor-three-DnVXDa-U.js',
      'assets/index-DcVwaCkX.css',
    ]);
  });

  it('ignores absolute and data references', () => {
    expect(extractAssetRefs('<img src="data:image/png;base64,AAA"><a href="//cdn.example/x.js">'))
      .toEqual([]);
  });

  it('tolerates empty or absent html', () => {
    expect(extractAssetRefs('')).toEqual([]);
    expect(extractAssetRefs(undefined)).toEqual([]);
  });
});

describe('commitMatches', () => {
  it('accepts a short sha prefix of the live commit', () => {
    expect(commitMatches(IDENTITY.commit, 'c4c1ab3')).toBe(true);
    expect(commitMatches(IDENTITY.commit, IDENTITY.commit)).toBe(true);
  });

  it('rejects a different commit and an unknown one', () => {
    expect(commitMatches(IDENTITY.commit, 'deadbee')).toBe(false);
    expect(commitMatches('unknown', 'c4c1ab3')).toBe(false);
  });

  it('is vacuously true with no expectation', () => {
    expect(commitMatches('unknown', null)).toBe(true);
  });
});

describe('evaluate', () => {
  const healthyEvidence = {
    identity: IDENTITY,
    assets: [{ url: 'https://x/assets/a.js', status: 200 }],
    passengers: [
      { file: 'watershed_native.js', expectedBytes: 33562, actualBytes: 33562 },
      { file: 'watershed_native.wasm', expectedBytes: 33811, actualBytes: 33811 },
    ],
  };

  it('passes a coherent deploy', () => {
    const result = evaluate(healthyEvidence);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.verdict).toContain('VERDICT: LIVE — commit=c4c1ab3');
  });

  it('fails when build-identity.json is absent (a pre-identity build is live)', () => {
    const result = evaluate({ ...healthyEvidence, identity: null });
    expect(result.ok).toBe(false);
    expect(result.verdict).toContain('VERDICT: NOT LIVE');
    expect(result.failures[0]).toContain('predates build identity');
  });

  it('names split provenance when a passenger size disagrees', () => {
    const result = evaluate({
      ...healthyEvidence,
      passengers: [
        { file: 'watershed_native.js', expectedBytes: 33562, actualBytes: 26999 },
        { file: 'watershed_native.wasm', expectedBytes: 33811, actualBytes: 33817 },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('SPLIT PROVENANCE');
    expect(result.failures.join(' ')).toContain('served 26999B');
  });

  it('fails on a broken asset reference', () => {
    const result = evaluate({
      ...healthyEvidence,
      assets: [{ url: 'https://x/assets/a.js', status: 404 }],
    });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain('HTTP 404');
  });

  it('fails --expect against a different live commit', () => {
    const result = evaluate({ ...healthyEvidence, expect: 'deadbee' });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain('expected commit deadbee');
  });

  it('passes --expect against the live commit', () => {
    expect(evaluate({ ...healthyEvidence, expect: 'c4c1ab3' }).ok).toBe(true);
  });

  it('fails a dirty live build', () => {
    const result = evaluate({ ...healthyEvidence, identity: { ...IDENTITY, dirty: true } });
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('dirty working tree');
  });

  it('skips passengers whose expected size is unknown', () => {
    const result = evaluate({
      ...healthyEvidence,
      passengers: [{ file: 'watershed_native.wasm', expectedBytes: 0, actualBytes: 999 }],
    });
    expect(result.ok).toBe(true);
  });
});

describe('verifyDeploy (stubbed server)', () => {
  it('reports LIVE for a coherent server', async () => {
    const result = await verifyDeploy({
      baseUrl: 'https://test.1ink.us/watershed/',
      fetchImpl: serverStub(HEALTHY),
    });
    expect(result.ok).toBe(true);
    expect(result.assets).toHaveLength(3);
    expect(result.verdict).toContain('LIVE');
  });

  it('reproduces the #402 shape: identity absent, passengers from different builds', async () => {
    const result = await verifyDeploy({
      baseUrl: 'https://test.1ink.us/watershed/',
      fetchImpl: serverStub({
        ...HEALTHY,
        'build-identity.json': { status: 404 },
        'watershed_native.js': { status: 200, bytes: 26999 },
        'watershed_native.wasm': { status: 200, bytes: 33817 },
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain('predates build identity');
  });

  it('exits-worthy failure when an asset 404s', async () => {
    const result = await verifyDeploy({
      baseUrl: 'https://test.1ink.us/watershed/',
      fetchImpl: serverStub({ ...HEALTHY, 'index-DcVwaCkX.css': { status: 404 } }),
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('HTTP 404');
  });

  it('honors --expect against the served identity', async () => {
    const stub = serverStub(HEALTHY);
    await expect(verifyDeploy({ baseUrl: 'https://x/', fetchImpl: stub, expect: 'c4c1ab3' }))
      .resolves.toMatchObject({ ok: true });
    await expect(verifyDeploy({ baseUrl: 'https://x/', fetchImpl: stub, expect: 'deadbee' }))
      .resolves.toMatchObject({ ok: false });
  });
});

describe('isIdentityEncoding (compressed-response hazard)', () => {
  it('trusts content-length only on an unencoded response', () => {
    expect(isIdentityEncoding(null)).toBe(true);
    expect(isIdentityEncoding('')).toBe(true);
    expect(isIdentityEncoding('identity')).toBe(true);
    expect(isIdentityEncoding('gzip')).toBe(false);
    expect(isIdentityEncoding(' BR ')).toBe(false);
  });

  it('measures the decoded body when the server gzips the wasm', async () => {
    // Live shape: 33817 B wasm advertised as content-length 16146 when gzipped.
    const fetchImpl = async (url, init = {}) => {
      const path = new URL(url).pathname.split('/').pop();
      if (path === 'build-identity.json') {
        return { ok: true, status: 200, text: async () => JSON.stringify(IDENTITY), headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
      }
      if (path === 'index.html') {
        return { ok: true, status: 200, text: async () => INDEX_HTML, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
      }
      const trueSize = path === 'watershed_native.wasm' ? 33811 : 33562;
      if (init.method === 'HEAD') {
        return {
          ok: true,
          status: 200,
          headers: { get: (n) => (n === 'content-encoding' ? 'gzip' : n === 'content-length' ? '16146' : null) },
          text: async () => '',
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => '',
        arrayBuffer: async () => new ArrayBuffer(trueSize),
      };
    };

    const result = await verifyDeploy({ baseUrl: 'https://x/', fetchImpl });
    const passengerFailures = result.failures.filter((f) => f.includes('SPLIT PROVENANCE'));
    expect(passengerFailures).toEqual([]);
  });
});
