/**
 * damRelease.campaign.test.ts — the first hazard, end to end, with no browser (#578 A.4).
 *
 * The hydro dam's 14:00 release (`hydro-dam-release`, hydro_dam.json) run headless through
 * SimCore, Rapier, the shipped WASM and its router:
 *
 *  - a pilot that ignores the telegraph (the plain centreline pilot) runs into the stilling basin
 *    while the gates are open, is reached once the routed surge has raised the water under it,
 *    and the hit lands on the survival layer: soaked, and chilled by the authored amount;
 *  - a pilot that heeds it (`cautious.ts`: holds short of the reach while the hazard telegraphs
 *    or is active) sees the same telegraph → active → spent and is never reached, then carries on;
 *  - at 06:00 the hazard never leaves dormant (it is live only at 14:00);
 *  - two runs stepped alike log the same transitions on the same ghost-clock instants and record
 *    the same SWE checksums at every split, with the release active.
 *
 * Maps run on the pilots test's clear day (temperature 0, snowpack 0.3), so the forecast floods
 * nothing and only the hour differs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import hydro from '../../maps/hydro_dam.json';
import { createHeadlessRun, type HeadlessRun } from '../../sim/headless/createHeadlessRun';
import { centrelinePilot } from '../../sim/headless/pilots/centreline';
import { cautiousPilot } from '../../sim/headless/pilots/cautious';
import { runUntil } from '../../sim/headless/pilots/runUntil';
import type { Pilot } from '../../sim/headless/pilots/pilot';
import { gameEvents } from '../events/GameEvents';
import { useGameStore } from '../GameState';
import { getActiveSurvivalState } from '../journey/runSession';
import { getRecordedSplitChecksums } from '../ghost/SplitRecorder';
import { sampleSweStage } from '../water/sweStageProbe';
import { getRecordedHazardLog } from './hazardLog';
import { HAZARD_RELEASE_REACH_FRACTION } from './hazardTypes';
import { parseHazards } from './parseHazards';

const RELEASE = parseHazards(hydro.hazards).find((h) => h.id === 'hydro-dam-release')!;
/** The vortex chamber's end: well past the basin, so a held pilot has to have carried on. */
const PAST_SEGMENT = 6;
const MAX_FRAMES = 12_000;

let live: HeadlessRun | null = null;
afterEach(() => {
  live?.dispose();
  live = null;
});

interface Drive {
  events: string[];
  log: ReturnType<typeof getRecordedHazardLog>;
  checksums: ReturnType<typeof getRecordedSplitChecksums>;
  result: ReturnType<typeof runUntil>;
  /** Survival and the stage under the body the moment the hazard reached it. */
  atHit: { wetness: number; coreTemp: number; stage: number | null } | null;
  coreBeforeActive: number | null;
}

async function drive(launchHour: number, pilotOf: (run: HeadlessRun) => Pilot): Promise<Drive> {
  live = await createHeadlessRun({
    mapId: 'hydro',
    launchHour,
    conditions: { temperature: 0, snowpackIndex: 0.3 },
    quality: 'medium',
  });
  const run = live;
  const events: string[] = [];
  let atHit: Drive['atHit'] = null;
  let coreBeforeActive: number | null = null;
  const offs = [
    gameEvents.on('hazard-phase', (e) => {
      events.push(`${e.hazardId}:${e.phase}`);
      if (e.phase === 'active') coreBeforeActive = getActiveSurvivalState()?.coreTemp ?? null;
    }),
    gameEvents.on('hazard-hit', (e) => {
      events.push(`${e.hazardId}:hit`);
      const p = run.body.translation();
      const s = getActiveSurvivalState();
      atHit = { wetness: s?.wetness ?? 0, coreTemp: s?.coreTemp ?? 1, stage: sampleSweStage(p.x, p.z) };
    }),
  ];
  try {
    const result = runUntil(run, pilotOf(run), {
      maxFrames: MAX_FRAMES,
      until: () => useGameStore.getState().currentSegmentIndex >= PAST_SEGMENT,
    });
    return { events, log: getRecordedHazardLog(), checksums: getRecordedSplitChecksums(), result, atHit, coreBeforeActive };
  } finally {
    for (const off of offs) off();
  }
}

describe('hydro dam release at 14:00 (headless)', () => {
  it('is authored with a release, a reach and a consequence', () => {
    expect(RELEASE.kind).toBe('damRelease');
    expect(RELEASE.hours).toEqual([14]);
    expect(RELEASE.release?.discharge).toBeGreaterThan(0);
    expect(RELEASE.consequence?.chill).toBeGreaterThan(0);
  });

  it('reaches a pilot that ignores the telegraph, once the surge has arrived', async () => {
    const { events, result, atHit, coreBeforeActive } = await drive(14, centrelinePilot);
    expect(result.wipeout).toBeNull();
    expect(result.stop).toBe('until');
    const id = RELEASE.id;
    expect(events).toEqual([`${id}:armed`, `${id}:telegraph`, `${id}:active`, `${id}:hit`, `${id}:spent`]);
    // Reached by the water, not by the hour: the routed release had raised the stage under the body.
    expect(atHit).not.toBeNull();
    expect(atHit!.stage).not.toBeNull();
    expect(atHit!.stage!).toBeGreaterThanOrEqual(RELEASE.release!.stage * HAZARD_RELEASE_REACH_FRACTION);
    // Soaked, and the chill landed on the survival layer.
    expect(atHit!.wetness).toBeGreaterThan(0.65);
    expect(coreBeforeActive).not.toBeNull();
    expect(atHit!.coreTemp).toBeLessThan(coreBeforeActive! - RELEASE.consequence!.chill! * 0.9);
  });

  it('never reaches a pilot that heeds the telegraph, which then carries on', async () => {
    const { events, result } = await drive(14, cautiousPilot);
    expect(result.wipeout).toBeNull();
    expect(result.stop).toBe('until');
    const id = RELEASE.id;
    expect(events).toEqual([`${id}:armed`, `${id}:telegraph`, `${id}:active`, `${id}:spent`]);
  });

  it('stays dormant on a 06:00 launch', async () => {
    const { events, log, result } = await drive(6, centrelinePilot);
    expect(result.stop).toBe('until');
    expect(events).toEqual([]);
    expect(log).toEqual([]);
  });

  it('logs the same transitions and records the same SWE checksums on two runs stepped alike', async () => {
    const a = await drive(14, centrelinePilot);
    live?.dispose();
    live = null;
    const b = await drive(14, centrelinePilot);
    expect(a.log.length).toBe(5);
    expect(b.log).toEqual(a.log);
    expect(a.checksums.length).toBeGreaterThan(3);
    expect(b.checksums).toEqual(a.checksums);
    expect(b.result.splits).toEqual(a.result.splits);
  });
});
