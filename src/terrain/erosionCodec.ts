/**
 * erosionCodec — an erosion plane as a short string for the save (#487 E).
 *
 * E is clamped to ±EROSION_MAX_DEPTH / EROSION_K, so it quantizes to a signed
 * byte (127 steps a side, ~3 mm at the default clamp). Most of a segment's
 * plane is untouched bank, so runs of zeros collapse: the byte -128 (never a
 * quantized value) followed by a count 1–255 stands for that many zeros. The
 * bytes go out as base64. A 11 × 26 hull grid that a storm worked is a few
 * hundred characters; an untouched one is not stored at all.
 */
import { EROSION_K, EROSION_MAX_DEPTH } from './erosion';

const LIMIT = EROSION_MAX_DEPTH / EROSION_K;
const RUN = -128;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export function encodeErosionPlane(plane: Float32Array): string {
  const out: number[] = [];
  let zeros = 0;
  const flush = () => {
    while (zeros > 0) {
      const n = Math.min(255, zeros);
      out.push(RUN & 0xff, n);
      zeros -= n;
    }
  };
  for (let i = 0; i < plane.length; i += 1) {
    const e = Number.isFinite(plane[i]) ? Math.max(-LIMIT, Math.min(LIMIT, plane[i])) : 0;
    const q = Math.round((e / LIMIT) * 127);
    if (q === 0) {
      zeros += 1;
      continue;
    }
    flush();
    out.push(q & 0xff);
  }
  flush();
  return toBase64(Uint8Array.from(out));
}

/** The plane `text` encodes, or null when it is not `size` values long or not ours. */
export function decodeErosionPlane(text: string, size: number): Float32Array | null {
  const bytes = fromBase64(text);
  if (!bytes || !(size > 0)) return null;
  const plane = new Float32Array(size);
  let at = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const q = (bytes[i] << 24) >> 24;
    if (q === RUN) {
      const n = bytes[i + 1];
      if (!n) return null;
      at += n;
      i += 1;
    } else {
      if (at >= size) return null;
      plane[at] = (q / 127) * LIMIT;
      at += 1;
    }
    if (at > size) return null;
  }
  return at === size ? plane : null;
}
