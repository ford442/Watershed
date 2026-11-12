import { describe, expect, it } from 'vitest';
import { deflateSync } from 'fflate';
import lumberLevel from '../../maps/lumber_flume.json';
import hydroLevel from '../../maps/hydro_dam.json';
import {
  SHARE_LINK_MAX_CHARS,
  decodeRiverPayload,
  encodeRiverFile,
  encodeRiverPayload,
  riverFileName,
  riverShareFragment,
  shareRiver,
  unwrapRiverDocument,
} from './riverShare';
import { parseRiverText, parseSharedRiver } from './userRiverImport';
import { createUserRiver, hashUserRiverLevel } from './userRiverSession';
import { canonicalJson } from '../../utils/canonicalJson';
import type { LevelData } from './MapSystem';

const lumber = lumberLevel as unknown as LevelData;
const hydro = hydroLevel as unknown as LevelData;

/** The same object with every key order reversed. */
function reorder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorder);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).reverse()) out[key] = reorder((value as Record<string, unknown>)[key]);
  return out;
}

describe('river share link', () => {
  it('round-trips a campaign map through the link, validated and playable', () => {
    const result = shareRiver(lumber, 'https://example.test/watershed/');
    expect(result.kind).toBe('link');
    if (result.kind !== 'link') return;
    expect(result.url.startsWith('https://example.test/watershed/#river=')).toBe(true);
    // Fragment only: nothing river-shaped in the part a browser sends to a host.
    expect(new URL(result.url).search).toBe('');
    const payload = riverShareFragment(new URL(result.url).hash);
    expect(payload).not.toBeNull();
    const river = parseSharedRiver(payload!);
    expect(river.level).toEqual(lumber);
    expect(river.label).toBe(lumber.metadata.name);
  });

  it('encodes canonically: key order does not change the link or the river hash', () => {
    const shuffled = reorder(lumber) as LevelData;
    expect(JSON.stringify(shuffled)).not.toBe(JSON.stringify(lumber));
    expect(encodeRiverPayload(shuffled)).toBe(encodeRiverPayload(lumber));
    expect(hashUserRiverLevel(shuffled)).toBe(hashUserRiverLevel(lumber));
    // So a ghost recorded on the author's file races fairly on the friend's link.
    const viaLink = parseSharedRiver(encodeRiverPayload(lumber));
    expect(viaLink.hash).toBe(createUserRiver('x', shuffled).hash);
  });

  it('a campaign-sized river fits under the chat-app cap', () => {
    expect(encodeRiverPayload(hydro).length).toBeLessThanOrEqual(SHARE_LINK_MAX_CHARS);
  });

  it('falls back to a file when the river is too big for a link', () => {
    const big = structuredClone(lumber);
    big.metadata = { ...big.metadata, description: Array.from({ length: 4000 }, (_, i) => `noise-${i * 7919}`).join(' ') };
    const result = shareRiver(big, 'https://example.test/');
    expect(result.kind).toBe('too-large');
  });

  it('refuses damaged links with messages fit for the menu', () => {
    expect(() => decodeRiverPayload('')).toThrow(/empty/);
    expect(() => decodeRiverPayload('not a link!')).toThrow(/damaged/);
    expect(() => decodeRiverPayload('AAAA')).toThrow(/damaged/);
    const notJson = Buffer.from(deflateSync(new TextEncoder().encode('hello'))).toString('base64url');
    expect(() => decodeRiverPayload(notJson)).toThrow(/not JSON/);
  });

  it('stops a deflate bomb before it is inflated', () => {
    const bomb = Buffer.from(deflateSync(new Uint8Array(4 * 1024 * 1024), { level: 9 })).toString('base64url');
    expect(bomb.length).toBeLessThan(SHARE_LINK_MAX_CHARS);
    expect(() => decodeRiverPayload(bomb)).toThrow(/larger than any river/);
  });

  it('a valid payload that is not a level fails validation', () => {
    const payload = Buffer.from(deflateSync(new TextEncoder().encode(canonicalJson({ metadata: { name: 'x' } })))).toString(
      'base64url',
    );
    expect(() => parseSharedRiver(payload)).toThrow(/failed level validation/);
  });
});

describe('.wsriver v2 envelope', () => {
  it('round-trips through the compressed file and is smaller than v1', () => {
    const text = encodeRiverFile(lumber);
    expect(text.length).toBeLessThan(JSON.stringify(lumber).length);
    const river = parseRiverText(text, 'Flume.wsriver');
    expect(river.level).toEqual(lumber);
    expect(river.id).toBe('flume');
  });

  it('v1 files (the plain level JSON) still import', () => {
    const river = parseRiverText(JSON.stringify(lumber, null, 2), 'Old.wsriver');
    expect(river.level).toEqual(lumber);
  });

  it('refuses a future version and a broken envelope', () => {
    expect(() => unwrapRiverDocument({ wsriver: 3, encoding: 'deflate-base64url', data: '' })).toThrow(/version 3/);
    expect(() => unwrapRiverDocument({ wsriver: 2, encoding: 'zip', data: '' })).toThrow(/unknown encoding/);
  });

  it('names the file after the river', () => {
    expect(riverFileName({ ...lumber, metadata: { ...lumber.metadata, name: 'A/B: c?' } })).toBe('A B c.wsriver');
  });
});

describe('riverShareFragment', () => {
  it('reads #river= and nothing else', () => {
    expect(riverShareFragment('#river=abc')).toBe('abc');
    expect(riverShareFragment('#x=1&river=abc')).toBe('abc');
    expect(riverShareFragment('#river=')).toBeNull();
    expect(riverShareFragment('#rivers=abc')).toBeNull();
    expect(riverShareFragment('')).toBeNull();
  });
});
