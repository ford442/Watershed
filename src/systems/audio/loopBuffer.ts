/**
 * loopBuffer.ts — make a decoded bed loop without a seam.
 *
 * An MP3 never decodes to the samples that were encoded: the encoder primes
 * with silence and pads the last frame, and the MDCT overlap smears both edges
 * into a short fade. A bed that was seamless before encoding therefore comes
 * back as `[silence][fade-in][content][fade-out][silence]`, and a naive
 * `setLoop(true)` dips at every wrap. Browsers disagree on how much of the
 * priming they strip, so a fixed offset cannot fix it.
 *
 * This works on whatever the decoder produced:
 *   1. trim near-silence off both ends,
 *   2. drop a guard band past the codec's fade regions,
 *   3. equal-power crossfade the tail over the head.
 *
 * Step 3 also makes any drop-in recorded bed loop, whatever its source. The
 * cost is `guard + crossfade` of material, ~80 ms on a multi-second bed.
 *
 * Pure Float32Array math — no AudioContext needed to test it.
 */

/** Below this a sample counts as codec silence. */
const SILENCE = 1e-4;

export interface LoopSeamOptions {
  /** Crossfade length in seconds. */
  crossfadeSeconds?: number;
  /** Samples dropped after the leading silence (encoder fade-in). */
  headGuard?: number;
  /** Samples dropped before the trailing silence (final-frame fade-out). */
  tailGuard?: number;
}

const DEFAULTS = {
  crossfadeSeconds: 0.06,
  // One MP3 granule in, one frame out: past the overlap fade on each side.
  headGuard: 576,
  tailGuard: 1152,
};

/**
 * Returns new channel arrays (the input is untouched), or `null` when the
 * material is too short to seam — the caller should then loop it as-is.
 */
export function seamLoopChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
  options: LoopSeamOptions = {},
): Float32Array[] | null {
  if (channels.length === 0 || !(sampleRate > 0)) return null;
  const length = channels[0].length;
  const headGuard = options.headGuard ?? DEFAULTS.headGuard;
  const tailGuard = options.tailGuard ?? DEFAULTS.tailGuard;
  const fade = Math.max(
    1,
    Math.round((options.crossfadeSeconds ?? DEFAULTS.crossfadeSeconds) * sampleRate),
  );

  // First / last sample that any channel carries signal on.
  let start = length;
  let end = -1;
  for (const ch of channels) {
    for (let i = 0; i < Math.min(start, ch.length); i += 1) {
      if (Math.abs(ch[i]) > SILENCE) { start = i; break; }
    }
    for (let i = ch.length - 1; i > end; i -= 1) {
      if (Math.abs(ch[i]) > SILENCE) { end = i; break; }
    }
  }
  if (end < start) return null;

  const from = start + headGuard;
  const to = end + 1 - tailGuard; // exclusive
  const usable = to - from;
  // Need a body at least as long as the fade on top of the fade itself.
  if (usable < fade * 3) return null;

  const outLength = usable - fade;
  return channels.map((ch) => {
    const out = ch.slice(from, from + outLength);
    // The tail that would have followed the loop end is crossfaded onto the
    // head, so out[outLength - 1] → out[0] continues the original signal.
    for (let i = 0; i < fade; i += 1) {
      const t = fade > 1 ? i / (fade - 1) : 1;
      out[i] = out[i] * Math.sin((t * Math.PI) / 2) + ch[from + outLength + i] * Math.cos((t * Math.PI) / 2);
    }
    return out;
  });
}

/** AudioBuffer wrapper: returns a new buffer, or the original if unseamable. */
export function seamLoopBuffer(
  buffer: AudioBuffer,
  createBuffer: (channels: number, length: number, sampleRate: number) => AudioBuffer,
  options?: LoopSeamOptions,
): AudioBuffer {
  const input: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c += 1) input.push(buffer.getChannelData(c));
  const seamed = seamLoopChannels(input, buffer.sampleRate, options);
  if (!seamed) return buffer;

  const out = createBuffer(seamed.length, seamed[0].length, buffer.sampleRate);
  seamed.forEach((data, c) => out.getChannelData(c).set(data));
  return out;
}
