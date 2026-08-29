/**
 * hydroFairness — launchHour + hydroEventHash + quality on .wsghost (#391 Phase B).
 *
 * Offline only. A mismatch is allowed and labeled; it is not rejected.
 */

import type { QualityPreset } from '../GameState';
import type { HydroEvent } from '../water/hydroEvents';
import { hashHydroEvents, eventsActiveAtHour } from '../water/hydroEvents';
import type { RunSplitEntry } from './ghostCodec';

export interface GhostHydroFairness {
  launchHour?: number;
  hydroEventHash?: string;
  qualityPreset?: QualityPreset;
}

export function buildGhostHydroFairness(input: {
  launchHour: number;
  events?: readonly HydroEvent[];
  qualityPreset: QualityPreset;
}): GhostHydroFairness {
  return {
    launchHour: input.launchHour,
    hydroEventHash: hashHydroEvents(input.events, input.launchHour),
    qualityPreset: input.qualityPreset,
  };
}

export function hydroFairnessDiffers(a?: GhostHydroFairness | null, b?: GhostHydroFairness | null): boolean {
  if (!a && !b) return false;
  const hourA = a?.launchHour;
  const hourB = b?.launchHour;
  const hashA = a?.hydroEventHash;
  const hashB = b?.hydroEventHash;
  const qualityA = a?.qualityPreset;
  const qualityB = b?.qualityPreset;
  if (hourA !== undefined && hourB !== undefined && hourA !== hourB) return true;
  if (hashA && hashB && hashA !== hashB) return true;
  if (qualityA && qualityB && qualityA !== qualityB) return true;
  return false;
}

export function describeHydroFairnessMismatch(
  self: GhostHydroFairness | null | undefined,
  other: GhostHydroFairness | null | undefined,
  otherLabel: 'PB' | 'rival',
): string | null {
  if (!hydroFairnessDiffers(self, other)) return null;
  const bits: string[] = [];
  if (
    self?.launchHour !== undefined &&
    other?.launchHour !== undefined &&
    self.launchHour !== other.launchHour
  ) {
    bits.push(
      `launch H${String(self.launchHour).padStart(2, '0')}:00 vs ${otherLabel} H${String(other.launchHour).padStart(2, '0')}:00`,
    );
  }
  if (self?.hydroEventHash && other?.hydroEventHash && self.hydroEventHash !== other.hydroEventHash) {
    bits.push(`hydro ${self.hydroEventHash} vs ${otherLabel} ${other.hydroEventHash}`);
  }
  if (self?.qualityPreset && other?.qualityPreset && self.qualityPreset !== other.qualityPreset) {
    bits.push(`quality ${self.qualityPreset} vs ${otherLabel} ${other.qualityPreset}`);
  }
  return bits.length > 0 ? bits.join(' · ') : `${otherLabel} ran a different river`;
}

/**
 * Blame the largest positive split delta on the hydro event that owns that
 * segment, so results can say the dam pulse cost the time — not the shelf.
 */
export function describeHydroSplitBlame(
  rows: ReadonlyArray<{ segmentIndex: number; deltaMs: number | null }>,
  events: readonly HydroEvent[] | undefined,
  hour: number,
): string | null {
  const active = eventsActiveAtHour(events, hour);
  if (active.length === 0) return null;
  let worst: { segmentIndex: number; deltaMs: number } | null = null;
  for (const row of rows) {
    if (row.deltaMs === null || row.deltaMs <= 0) continue;
    if (!worst || row.deltaMs > worst.deltaMs) {
      worst = { segmentIndex: row.segmentIndex, deltaMs: row.deltaMs };
    }
  }
  if (!worst) return null;
  const event = active.find((item) => item.segmentIndex === worst!.segmentIndex);
  if (!event) return null;
  const seconds = (worst.deltaMs / 1000).toFixed(1);
  return `you lost ${seconds}s at ${event.id}, not at the shelf`;
}

export function fairnessFromGhostFile(file: {
  launchHour?: number;
  hydroEventHash?: string;
  qualityPreset?: QualityPreset;
}): GhostHydroFairness {
  return {
    launchHour: file.launchHour,
    hydroEventHash: file.hydroEventHash,
    qualityPreset: file.qualityPreset,
  };
}

export function eventLabelForSegment(
  splits: readonly RunSplitEntry[],
  events: readonly HydroEvent[] | undefined,
  hour: number,
): string | null {
  const active = eventsActiveAtHour(events, hour);
  for (const split of splits) {
    const hit = active.find((event) => event.segmentIndex === split.segmentIndex);
    if (hit) return hit.id;
  }
  return null;
}
