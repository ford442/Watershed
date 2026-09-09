import {
  BUILD_IDENTITY_GLOBAL,
  UNKNOWN,
  UNKNOWN_BUILD_IDENTITY,
  formatBuildIdentity,
  hasPassengerSizes,
  installBuildIdentity,
  parseBuildIdentity,
} from './buildIdentity';
import {
  makeBuildIdentity,
  parseArtifactStamp,
  formatIdentityLine,
} from '../scripts/buildIdentity.mjs';

const FULL = {
  schema: 1,
  commit: 'c4c1ab3f00dbeef1234567890abcdef123456789',
  commitShort: 'c4c1ab3',
  dirty: false,
  builtAt: '2026-09-09T12:00:00.000Z',
  wasmStamp: '4d5ade0f0dc990a0',
  glueFile: 'watershed_native.js',
  wasmFile: 'watershed_native.wasm',
  glueBytes: 27029,
  wasmBytes: 33840,
};

describe('parseBuildIdentity', () => {
  it('round-trips a well-formed JSON string', () => {
    expect(parseBuildIdentity(JSON.stringify(FULL))).toEqual(FULL);
  });

  it('accepts an already-parsed object', () => {
    expect(parseBuildIdentity(FULL)).toEqual(FULL);
  });

  it('falls back to unknown on malformed JSON', () => {
    expect(parseBuildIdentity('{not json')).toEqual(UNKNOWN_BUILD_IDENTITY);
  });

  it('falls back to unknown on undefined (no-git / no-define build)', () => {
    expect(parseBuildIdentity(undefined)).toEqual(UNKNOWN_BUILD_IDENTITY);
    expect(parseBuildIdentity(null)).toEqual(UNKNOWN_BUILD_IDENTITY);
    expect(parseBuildIdentity(42)).toEqual(UNKNOWN_BUILD_IDENTITY);
  });

  it('derives commitShort from commit when it is missing', () => {
    const parsed = parseBuildIdentity({ commit: FULL.commit });
    expect(parsed.commitShort).toBe('c4c1ab3');
  });

  it('coerces bogus byte sizes to 0 so the provenance assert stays disabled', () => {
    const parsed = parseBuildIdentity({ ...FULL, glueBytes: -1, wasmBytes: 'lots' });
    expect(parsed.glueBytes).toBe(0);
    expect(parsed.wasmBytes).toBe(0);
    expect(hasPassengerSizes(parsed)).toBe(false);
  });

  it('reports usable passenger sizes on a real identity', () => {
    expect(hasPassengerSizes(parseBuildIdentity(FULL))).toBe(true);
  });
});

describe('formatBuildIdentity', () => {
  it('summarises commit, stamp and passenger sizes on one line', () => {
    expect(formatBuildIdentity(parseBuildIdentity(FULL))).toBe(
      'commit=c4c1ab3 stamp=4d5ade0f0dc990a0 glue=27029B wasm=33840B builtAt=2026-09-09T12:00:00.000Z',
    );
  });

  it('marks a dirty tree', () => {
    expect(formatBuildIdentity(parseBuildIdentity({ ...FULL, dirty: true }))).toContain(
      'commit=c4c1ab3-dirty',
    );
  });

  it('matches the node-side formatter for the same identity', () => {
    expect(formatIdentityLine(FULL)).toBe(formatBuildIdentity(parseBuildIdentity(FULL)));
  });
});

describe('installBuildIdentity', () => {
  it('installs on the supplied global object', () => {
    const target: Record<string, unknown> = {};
    const identity = parseBuildIdentity(FULL);
    expect(installBuildIdentity(target, identity)).toBe(identity);
    expect(target[BUILD_IDENTITY_GLOBAL]).toBe(identity);
  });

  it('is a no-op without a global target (SSR / worker-less env)', () => {
    const identity = parseBuildIdentity(FULL);
    expect(installBuildIdentity(undefined, identity)).toBe(identity);
  });

  it('installed itself on import so a browser console can read it', () => {
    expect((globalThis as Record<string, unknown>)[BUILD_IDENTITY_GLOBAL]).toBeDefined();
  });
});

describe('scripts/buildIdentity.mjs (build-time resolution)', () => {
  it('extracts the stamp from the generated module source', () => {
    expect(
      parseArtifactStamp("export const WASM_ARTIFACT_STAMP = '4d5ade0f0dc990a0';"),
    ).toBe('4d5ade0f0dc990a0');
  });

  it('returns unknown when the stamp module is missing or unparsable', () => {
    expect(parseArtifactStamp('')).toBe(UNKNOWN);
    expect(parseArtifactStamp(undefined)).toBe(UNKNOWN);
    expect(parseArtifactStamp('export const SOMETHING_ELSE = 1;')).toBe(UNKNOWN);
  });

  it('produces an unknown-but-valid identity with no inputs (CI tarball, Colab)', () => {
    const identity = makeBuildIdentity();
    expect(identity.commit).toBe(UNKNOWN);
    expect(identity.wasmStamp).toBe(UNKNOWN);
    expect(identity.glueBytes).toBe(0);
    // Still parses cleanly on the browser side.
    expect(parseBuildIdentity(JSON.stringify(identity))).toEqual(UNKNOWN_BUILD_IDENTITY);
  });

  it('carries git + passenger sizes straight through', () => {
    const identity = makeBuildIdentity({
      commit: FULL.commit,
      commitShort: FULL.commitShort,
      dirty: true,
      builtAt: FULL.builtAt,
      wasmStamp: FULL.wasmStamp,
      glueBytes: FULL.glueBytes,
      wasmBytes: FULL.wasmBytes,
    });
    expect(parseBuildIdentity(JSON.stringify(identity))).toEqual({ ...FULL, dirty: true });
  });
});
