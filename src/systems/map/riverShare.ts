/**
 * riverShare.ts — a river as a link, and as a compressed `.wsriver`
 * (River Workshop D). No server: the river itself rides the URL.
 *
 *   link     `<page>#river=<base64url(deflate(canonical JSON))>`
 *            A fragment, so it never reaches a host's request log, and the
 *            game opens it offline from a cached copy.
 *   file     `{ "wsriver": 2, "encoding": "deflate-base64url", "data": "…" }`
 *            The same payload in a JSON envelope, for a river too big for a
 *            link. A v1 `.wsriver` (the plain level JSON) still loads:
 *            `unwrapRiverDocument` passes it through.
 *
 * fflate rides this module, so it is only ever imported from lazy chunks (the
 * Workshop, and userRiverImport behind the StartMenu's river panel) — never
 * from the entry.
 */

import { Inflate, deflateSync, strFromU8, strToU8 } from 'fflate';
import { canonicalJson } from '../../utils/canonicalJson';
import { currentHash } from '../../config/queryFlags';
import type { LevelData } from './MapSystem.types';

/** Encoded payload a link may carry: past this, chat apps truncate or refuse. */
export const SHARE_LINK_MAX_CHARS = 8000;
/** A payload larger than this is not one the game made (and is not decoded). */
export const SHARE_PAYLOAD_MAX_CHARS = 512 * 1024;
/** Inflated size ceiling (a river is under 2 MB; see userRiverImport). */
export const SHARE_INFLATED_MAX_BYTES = 2 * 1024 * 1024;

export const RIVER_FILE_VERSION = 2;
export const RIVER_FILE_ENCODING = 'deflate-base64url';

export interface RiverFileEnvelope {
  wsriver: typeof RIVER_FILE_VERSION;
  encoding: typeof RIVER_FILE_ENCODING;
  /** The river's display name, readable without inflating. */
  name?: string;
  data: string;
}

// --- base64url ---------------------------------------------------------------

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('That river link is damaged (it has characters a link never carries).');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new Error('That river link is damaged (it is not base64url).');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

// --- deflate -----------------------------------------------------------------

/** Inflate with a ceiling: fed in small pieces so a deflate bomb stops early. */
function inflateBounded(data: Uint8Array, maxBytes: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > maxBytes) throw new Error('That river is larger than any river the game makes.');
    parts.push(chunk);
  });
  const STEP = 256;
  try {
    for (let i = 0; i < data.length; i += STEP) {
      inflater.push(data.subarray(i, Math.min(data.length, i + STEP)), i + STEP >= data.length);
    }
    if (data.length === 0) inflater.push(data, true);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('That river')) throw err;
    throw new Error('That river link is damaged (it does not decompress).', { cause: err });
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** base64url(deflate(canonical JSON of `level`)). */
export function encodeRiverPayload(level: LevelData): string {
  return bytesToBase64Url(deflateSync(strToU8(canonicalJson(level)), { level: 9 }));
}

/** The JSON document a payload carries (not yet validated as a level). */
export function decodeRiverPayload(payload: string): unknown {
  const trimmed = payload.trim();
  if (trimmed.length === 0) throw new Error('That river link is empty.');
  if (trimmed.length > SHARE_PAYLOAD_MAX_CHARS) throw new Error('That river link is far too long to be a river.');
  const text = strFromU8(inflateBounded(base64UrlToBytes(trimmed), SHARE_INFLATED_MAX_BYTES));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('That river link is damaged (its contents are not JSON).');
  }
}

// --- link ----------------------------------------------------------------------

/**
 * `#river=<payload>` in a fragment (default: the page's, via queryFlags'
 * `currentHash`). Fragment-only on purpose: it never reaches a host's request
 * log. The raw payload, or null when the fragment carries none.
 */
export function riverShareFragment(hash: string = currentHash()): string | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of body.split('&')) {
    if (part.startsWith('river=')) {
      const payload = part.slice('river='.length);
      return payload.length > 0 ? payload : null;
    }
  }
  return null;
}

export type ShareResult =
  | { kind: 'link'; url: string; payloadChars: number }
  | { kind: 'too-large'; payloadChars: number };

/**
 * The share link for `level` on `pageUrl` (default: this page, without its
 * query or fragment), or `too-large` when the payload is over the link cap and
 * the river should travel as a file instead.
 */
export function shareRiver(level: LevelData, pageUrl?: string): ShareResult {
  const payload = encodeRiverPayload(level);
  if (payload.length > SHARE_LINK_MAX_CHARS) return { kind: 'too-large', payloadChars: payload.length };
  const base =
    pageUrl ?? (typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : '');
  return { kind: 'link', url: `${base}#river=${payload}`, payloadChars: payload.length };
}

// --- file ----------------------------------------------------------------------

/** A compressed `.wsriver` (v2 envelope) as text. */
export function encodeRiverFile(level: LevelData): string {
  const envelope: RiverFileEnvelope = {
    wsriver: RIVER_FILE_VERSION,
    encoding: RIVER_FILE_ENCODING,
    ...(level.metadata?.name ? { name: level.metadata.name } : {}),
    data: encodeRiverPayload(level),
  };
  return `${JSON.stringify(envelope)}\n`;
}

function isEnvelope(raw: unknown): raw is { wsriver: unknown; encoding?: unknown; data?: unknown } {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && 'wsriver' in raw;
}

/**
 * The level document inside a parsed `.wsriver`: a v2 envelope is inflated,
 * anything else (a v1 file — the plain level JSON) is returned as it is.
 */
export function unwrapRiverDocument(raw: unknown): unknown {
  if (!isEnvelope(raw)) return raw;
  if (raw.wsriver !== RIVER_FILE_VERSION) {
    throw new Error(`That river file is version ${String(raw.wsriver)}; this game reads version ${RIVER_FILE_VERSION} and older.`);
  }
  if (raw.encoding !== RIVER_FILE_ENCODING || typeof raw.data !== 'string') {
    throw new Error('That river file is damaged (unknown encoding).');
  }
  return decodeRiverPayload(raw.data);
}

/** A file name for `level`: `My Canyon.wsriver`. */
export function riverFileName(level: LevelData): string {
  const name = (level.metadata?.name || 'river').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${name || 'river'}.wsriver`;
}
