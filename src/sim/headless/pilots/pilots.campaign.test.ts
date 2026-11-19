/**
 * pilots.campaign.test.ts — headless pilots against whole maps (#556 C).
 *
 * (a) the ghost pilot reproduces the B pin through the same `runUntil` the others use;
 * (b) the centreline pilot finishes a map with no obstacle colliders — "every map finishable" is
 *     the ruler later hazard tuning (#553) reads;
 * (c) the same with the page's static obstacle colliders mounted;
 * (d) the maps it does not finish are `it.todo`, each with the measured reason: a pilot that is
 *     allowed to fail silently is not a ruler.
 *
 * Maps are run on a clear day at launch hour 18. The default launch hour (6) is the flood's peak:
 * the day's forecast washes segments 7..12 of the meander out (`openFloor`: no collider at all, a
 * 600 m gap) and floods 0..6 — a day nobody finishes on foot. `FLOW_FORECAST` at 18 floods the
 * whole day, and with `temperature: 0` / `snowpackIndex: 0.3` it is `Normal` throughout.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { MapRegistryId } from '../../../maps/registry';
import { importGhostFromJson } from '../../../systems/ghost/ghostExport';
import { getRecordedSplitChecksums } from '../../../systems/ghost/SplitRecorder';
import { createHeadlessRun, type HeadlessRun, type HeadlessRunOptions } from '../createHeadlessRun';
import { centrelinePilot } from './centreline';
import { ghostPilot } from './ghost';
import { runUntil } from './runUntil';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../../../verification/fixtures/${name}`, import.meta.url));

/** The browser's side of the B pin: the splits and SWE checksums the replay smoke printed. */
const trace = JSON.parse(readFileSync(fixture('headless/meander_trace.json'), 'utf8')) as {
  splits: { segmentIndex: number; tMs: number }[];
  checksums: string[];
};

let live: HeadlessRun | null = null;
afterEach(() => {
  live?.dispose();
  live = null;
});

const CLEAR_DAY: Pick<HeadlessRunOptions, 'launchHour' | 'conditions' | 'quality'> = {
  launchHour: 18,
  conditions: { temperature: 0, snowpackIndex: 0.3 },
  quality: 'medium',
};

async function drive(mapId: MapRegistryId, extra: Partial<HeadlessRunOptions> = {}, maxFrames = 40_000) {
  live = await createHeadlessRun({ mapId, ...CLEAR_DAY, ...extra });
  const result = runUntil(live, centrelinePilot(live), { maxFrames });
  return { run: live, result };
}

describe('ghost pilot', () => {
  it('reproduces the B pin through runUntil: splits and SWE checksums are the browser replay smoke\'s, `===`', async () => {
    const parsed = importGhostFromJson(readFileSync(fixture('headless/meander_run.wsghost'), 'utf8'));
    if (!parsed.ok) throw new Error(`ghost rejected: ${parsed.reason}`);
    const ghost = ghostPilot(parsed.file);
    if (!ghost) throw new Error('ghost cannot be replayed');
    const { plan } = ghost;
    live = await createHeadlessRun({
      mapId: plan.mapId,
      launchHour: plan.launchHour,
      seed: plan.seed,
      conditions: plan.conditions,
      quality: 'medium',
    });
    // 1500 frames, as the pin steps them (the smoke stops at the segment-3 split, 24 s; the rest is slack).
    const result = runUntil(live, ghost.input, { maxFrames: 1500 });
    expect(result.stop).toBe('maxFrames');
    expect(result.frames).toBe(1500);
    expect(result.wipeout).toBeNull();
    expect(result.splits).toEqual(trace.splits.map((s) => [s.segmentIndex, s.tMs]));
    expect(getRecordedSplitChecksums()).toEqual(trace.checksums);
  });
});

describe('centreline pilot', () => {
  it('finishes meander_to_waterfall with no obstacle colliders', async () => {
    const { run, result } = await drive('meander');
    expect(result.wipeout).toBeNull();
    expect(result.stop).toBe('finished');
    expect(result.finished).toBe(true);
    // The map's last segment (`journeyComplete` in meander_to_waterfall.ts).
    expect(run.finish?.segmentIndex).toBe(38);
    // A run takes ~340 sim seconds; a pilot that crawls or never lands trips this long before the cap.
    expect(result.frames).toBeLessThan(30_000);
    expect(result.splits.length).toBeGreaterThan(30);
  });

  it('finishes meander_to_waterfall with the page\'s static obstacle colliders mounted', async () => {
    const { run, result } = await drive('meander', { obstacleColliders: true });
    expect(run.obstacles?.count()).toBeGreaterThan(0);
    expect(result.wipeout).toBeNull();
    expect(result.stop).toBe('finished');
    expect(run.finish?.segmentIndex).toBe(38);
    expect(result.frames).toBeLessThan(30_000);
  });

  it('finishes the hydro dam (journeyComplete at segment 15)', async () => {
    const { run, result } = await drive('hydro');
    expect(result.wipeout).toBeNull();
    expect(result.stop).toBe('finished');
    expect(run.finish?.segmentIndex).toBe(15);
  });

  it('finishes the delta (journeyComplete at segment 21)', async () => {
    const { run, result } = await drive('delta');
    expect(result.wipeout).toBeNull();
    expect(result.stop).toBe('finished');
    expect(run.finish?.segmentIndex).toBe(21);
  });

  // Not finished, with the measured reason (clear day, launch hour 18, colliders on or off alike).
  it.todo(
    'glacial: wipeout at frame 3904 in segment 10, above-envelope — the pilot is airborne at y -462 against the segment\'s authored ceiling -476 (safeZone yMax 150): the runner falls at ~8 m/s (the vehicle tuner\'s always-on water damping, a page quirk) while the tube drops faster, and the pilot has no slower line than airSpeed 8',
  );
  it.todo(
    'lumber: wipeout at frame 22189 in segment 37, below-envelope — the runner fell 80 m under that segment\'s lowest centreline point; cause not investigated (the open-floor waterfall at segment 10 is crossed)',
  );
});

describe('obstacle colliders', () => {
  it('are off by default, and mounted (cuboids on the live segments) when asked', async () => {
    live = await createHeadlessRun({ mapId: 'meander', ...CLEAR_DAY });
    expect(live.obstacles).toBeNull();
    live.dispose();

    live = await createHeadlessRun({ mapId: 'meander', ...CLEAR_DAY, obstacleColliders: true });
    const obstacles = live.obstacles;
    expect(obstacles).not.toBeNull();
    // Segments -3..3 are live at the start: 2 or 3 pooled rocks / logs each, 16 slots.
    expect(obstacles?.count()).toBeGreaterThan(8);
  });
});
