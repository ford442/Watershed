/**
 * wallClock.ts — the sanctioned wall-clock reads for sim-side code.
 *
 * Gameplay under src/systems, src/vehicles, src/physics, src/sim and
 * src/components/Obstacles runs on sim time (the frame delta, R3F's clock), so
 * a scripted run, a replay or a ghost gives the same splits on any machine
 * under any load. ESLint bans `Date.now`, `performance.now` and the timer
 * globals there (eslint.config.js, "sim time"); the two reads below are the
 * exceptions, and their names say what they are for. Neither may feed sim
 * state: a value from here ends up in a file or a debug readout, never in a
 * force, a timer or a branch the sim takes.
 */

/** Epoch ms for metadata stamps: save files, exports, the daily-river date. */
export function wallClockEpochMs(): number {
  return Date.now();
}

/** Monotonic ms for telemetry: latency and compute-time readouts only. */
export function telemetryNowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
