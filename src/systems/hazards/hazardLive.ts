/**
 * hazardLive — what the hazards are doing right now, for whoever draws, plays or
 * routes them (#578 A). Store-free and tiny: it sits on the entry side, and the
 * lazy hazard runtime (hazardRuntime.ts) is its only writer.
 *
 * Two readers, two halves:
 *
 *  - The release: the discharge an active hazard's gates add and the segment
 *    they open onto. sweHost reads it once per SWE step and hands it to the
 *    river router (or the sim worker's, on the STEP), exactly as it hands over
 *    the WeatherDirector's weather. Null whenever nothing is releasing, so a
 *    run without hazards routes exactly as before.
 *  - The headline list: every hazard that is armed, telegraphing or active, with
 *    its sim-clock countdown. The telegraph renderer and the HUD banner poll it
 *    (a version bump on every phase change; `secondsLeft` is rewritten in place
 *    each step), so neither keeps a clock of its own and a pause stops both.
 *
 * Nothing here steps anything; a reader that finds nothing draws nothing.
 */
import type { HazardKind } from './hazardTypes';

/** The phases a player can see. */
export type LiveHazardPhase = 'armed' | 'telegraph' | 'active';

export interface LiveHazard {
  readonly id: string;
  readonly kind: HazardKind;
  readonly segmentIndex: number;
  phase: LiveHazardPhase;
  /** Sim seconds left in the phase (the telegraph's countdown); null while armed. */
  secondsLeft: number | null;
  /** World anchor on the live segment frame; null while its segment is off the treadmill. */
  anchor: [number, number, number] | null;
  /** Horizontal reach of the active hazard, metres. */
  radius: number;
  /** Stage (m above the still sheet) the hazard raises the water to; null for one that releases none. */
  stage: number | null;
}

/** A release joining the river this step: the authored segment the gates open onto. */
export interface LiveRelease {
  segmentIndex: number;
  /** m³/s */
  discharge: number;
}

let hazards: readonly LiveHazard[] = [];
let version = 0;
let release: LiveRelease | null = null;
const listeners = new Set<() => void>();

/** The hazard runtime, after a step that changed which hazards are up or their phases. */
export function publishLiveHazards(next: readonly LiveHazard[]): void {
  hazards = next;
  version += 1;
  for (const listener of listeners) listener();
}

/**
 * Called on every membership / phase change (never per step). The page mounts
 * the telegraph and the HUD banner through it, only while a hazard is up.
 */
export function subscribeLiveHazards(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while any hazard is armed, telegraphing or active. */
export function anyHazardUp(): boolean {
  return hazards.length > 0;
}

/** Armed, telegraphing and active hazards, in authored order. Do not mutate. */
export function getLiveHazards(): readonly LiveHazard[] {
  return hazards;
}

/** Bumps on every change of membership or phase (not on the per-step countdown). */
export function getLiveHazardsVersion(): number {
  return version;
}

/** The hazard runtime, each step: the release in effect now, or null. */
export function publishHazardRelease(next: LiveRelease | null): void {
  if (!next || !(next.discharge > 0) || !Number.isFinite(next.discharge)) {
    release = null;
    return;
  }
  if (!release) release = { segmentIndex: next.segmentIndex, discharge: next.discharge };
  else {
    release.segmentIndex = next.segmentIndex;
    release.discharge = next.discharge;
  }
}

/** The release joining the river now (the same object every call while one runs); null for none. */
export function getHazardRelease(): Readonly<LiveRelease> | null {
  return release;
}

/** A run reset, a map without hazards, or a test: nothing is up and nothing releases. */
export function resetHazardLive(): void {
  if (hazards.length > 0) publishLiveHazards([]);
  release = null;
}
