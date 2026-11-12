/**
 * headless.campaign.test.ts — the Node harness against the page (#556 B.2).
 *
 * A headless run is only worth having if it is the page's run. Two recordings
 * of the browser (Chromium + SwiftShader, `pnpm build` of the base this was
 * cut on) are committed under verification/fixtures/headless/ and compared
 * here with `===`, not a tolerance:
 *
 *   - meander_trace.json  — the input smoke's scripted meander
 *     (verification/headless_trace.mjs records it): every 10th frame the
 *     runner's position and the flow the water gave it (window origin, sampled
 *     speed, stage), then the splits and the SWE state checksums at them. The
 *     first 700 frames' flow was also compared frame by frame while the harness
 *     was built: positions bit-exact, flow identical.
 *   - meander_run.wsghost — the run the replay smoke recorded from that script
 *     (`pnpm test:replay-smoke`), replayed through the same input path
 *     (`replayPlanFromFile`); the smoke prints its four checksums.
 *
 * The 600-frame mark is the 10-second row of the trace: same pose, same flow.
 *
 * A harness that reproduces a bug reproduces it on purpose. The page has one the
 * pin depends on (`pageQuirks.spareSlotsDropBedZero`, createHeadlessRun.ts): no
 * SWE bed under segment 0. The last test shows what the run reads without it.
 * When the page is fixed the browser smokes' checksums change, this pin fails,
 * and the fix is: flip the quirk's default, re-record (headless_trace.mjs and the
 * replay smoke), and say why in the PR.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { replayPlanFromFile } from '../../input/replay';
import { parseInputScript } from '../../input/sources/ScriptedSource';
import { importGhostFromJson } from '../../systems/ghost/ghostExport';
import { getRecordedSplitChecksums, getRecordedSplits } from '../../systems/ghost/SplitRecorder';
import { useGameStore } from '../../systems/GameState';
import { getRegisteredBathymetrySource } from '../../systems/water/bathymetrySampler';
import { createHeadlessRun, type HeadlessRun } from './createHeadlessRun';
import { scriptedHeadlessInput, stepHeadless } from './stepHeadless';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../../verification/fixtures/${name}`, import.meta.url));

interface TraceRow {
  frame: number;
  pos: [number, number, number];
  speed: number;
  segment: number;
  flow: { originX: number; originZ: number; speed: number; stage: number } | null;
}
interface Trace {
  every: number;
  frames: number;
  rows: TraceRow[];
  splits: { segmentIndex: number; tMs: number; speed: number }[];
  checksums: string[];
}

const trace = JSON.parse(readFileSync(fixture('headless/meander_trace.json'), 'utf8')) as Trace;
const meanderScript = () =>
  scriptedHeadlessInput(parseInputScript(JSON.parse(readFileSync(fixture('input/meander_run.json'), 'utf8'))));

/** What the replay smoke prints for the committed ghost (and its recording): seg 0..3 → `swe` per split. */
const REPLAY_SPLITS = [
  [0, 11400],
  [1, 15400],
  [2, 19500],
  [3, 23500],
];
const REPLAY_CHECKSUMS = ['9a1952b8', '36bb12c6', '6280ddeb', 'a4da233b'];

let live: HeadlessRun | null = null;
afterEach(() => {
  live?.dispose();
  live = null;
});

async function startMeander(options: Partial<Parameters<typeof createHeadlessRun>[0]> = {}): Promise<HeadlessRun> {
  live = await createHeadlessRun({ mapId: 'meander', quality: 'medium', ...options });
  return live;
}

const splitPairs = () => getRecordedSplits().map((s) => [s.segmentIndex, s.tMs]);

describe('headless run vs the browser', () => {
  it('replays the committed meander ghost: splits and SWE checksums match the replay smoke', async () => {
    const result = importGhostFromJson(readFileSync(fixture('headless/meander_run.wsghost'), 'utf8'));
    if (!result.ok) throw new Error(`ghost rejected: ${result.reason}`);
    const plan = replayPlanFromFile(result.file);
    if (!plan) throw new Error('ghost cannot be replayed');
    const run = await startMeander({
      mapId: plan.mapId,
      launchHour: plan.launchHour,
      seed: plan.seed,
      conditions: plan.conditions,
    });
    // The smoke stops at the segment-3 split (24 s); a second more is slack, not a different run.
    stepHeadless(run, 1500, scriptedHeadlessInput(plan.script), { commitEvery: 60 });
    expect(splitPairs()).toEqual(REPLAY_SPLITS);
    expect(getRecordedSplitChecksums()).toEqual(REPLAY_CHECKSUMS);
    expect(useGameStore.getState().isWipeout).toBe(false);
  });

  it('runs the scripted meander as the page does, frame by frame: pose, flow at the runner, splits, SWE state', async () => {
    const run = await startMeander();
    const input = meanderScript();
    const seen: number[] = [];
    for (const row of trace.rows) {
      stepHeadless(run, trace.every, input, { commitEvery: 60 });
      const p = run.body.translation();
      const flow = run.water.lastFlow;
      const at = `frame ${row.frame}`;
      expect({ at, pos: [p.x, p.y, p.z] }).toEqual({ at, pos: row.pos });
      expect({ at, speed: useGameStore.getState().currentSpeed }).toEqual({ at, speed: row.speed });
      expect({ at, segment: useGameStore.getState().currentSegmentIndex }).toEqual({ at, segment: row.segment });
      expect({
        at,
        flow: flow && { originX: run.water.lastOrigin.x, originZ: run.water.lastOrigin.z, speed: flow.speed, stage: flow.surfaceOffset },
      }).toEqual({ at, flow: row.flow });
      seen.push(row.frame);
    }
    // 600 frames (10 s) is one of the rows: the pose and flow above are the browser's there too.
    expect(seen).toContain(600);
    expect(getRecordedSplits().map((s) => ({ segmentIndex: s.segmentIndex, tMs: s.tMs, speed: s.speed }))).toEqual(trace.splits);
    expect(getRecordedSplitChecksums()).toEqual(trace.checksums);
    expect(trace.checksums).toEqual(REPLAY_CHECKSUMS);
  });

  it('is the same run whenever React would have committed (every frame, or every 60 like the smokes)', async () => {
    const run = await startMeander();
    stepHeadless(run, 1500, meanderScript(), { commitEvery: 1 });
    expect(getRecordedSplitChecksums()).toEqual(REPLAY_CHECKSUMS);
  });

  it('is repeatable: a second run in the same process reads the same numbers', async () => {
    for (let pass = 0; pass < 2; pass += 1) {
      const run = await startMeander();
      stepHeadless(run, 1500, meanderScript());
      expect(splitPairs()).toEqual(REPLAY_SPLITS);
      expect(getRecordedSplitChecksums()).toEqual(REPLAY_CHECKSUMS);
      run.dispose();
      live = null;
    }
  });

  it('shows the page quirk it reproduces: the spare pool slots take the bed of segment 0 with them', async () => {
    const quirk = await startMeander();
    expect(getRegisteredBathymetrySource(0)).toBeUndefined();
    expect(getRegisteredBathymetrySource(1)).toBeDefined();
    quirk.dispose();

    const fixed = await startMeander({ pageQuirks: { spareSlotsDropBedZero: false } });
    expect(getRegisteredBathymetrySource(0)).toBeDefined();
    stepHeadless(fixed, 1500, meanderScript());
    // Same positions, same splits; the water differs only where segment 0's floor is part of the field.
    expect(splitPairs()).toEqual(REPLAY_SPLITS);
    // Segments 2 and 3 are past segment 0's reach by their splits: those two checksums are the page's.
    expect(getRecordedSplitChecksums()).toEqual(['65fcb57e', '118b1329', '6280ddeb', 'a4da233b']);
  });
});
