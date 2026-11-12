/**
 * stepHeadless.ts — advance a headless run frame by frame (#556 B.2).
 *
 * The page advances a scripted run with `stepScripted(n)` (input/scriptedRun.ts):
 * n times, R3F's `advance(simTimeSec + ε)` runs the frame's `useFrame`
 * subscribers in priority order. This is that frame, without R3F:
 *
 *   −100  input hub tick (+ the script's camera look)
 *   −90   SimCore: sample the world into ctx, one fixed step (weather … score,
 *         the Rapier world, the runner)
 *   0     the runner's camera follow · the water field and its forces · the
 *         splash disturbances · the treadmill (segment entry, generation) ·
 *         the lifecycle's HUD mirror and out-of-bounds check
 *
 * R3F's clock is reproduced too: frame n's timestamp is `simTimeSec + 1e-6`
 * (the page's ACCUMULATOR_BIAS_SEC), its delta the difference of consecutive
 * timestamps, its `elapsedTime` the timestamp — the numbers WaterForceSystem
 * hands the SWE step and its turbulence phase.
 *
 * Where a page frame would wait for React to commit (a treadmill append mounts
 * its segment's collider and bed; an erosion refresh remeshes a hull), a
 * headless step applies it at the end of the frame by default
 * (`commitEvery: 1`, what a real 60 Hz game does). The page's browser smokes
 * step 60 frames inside one JS task, so React commits between those batches,
 * not between frames: pass `commitEvery: 60` to reproduce that cadence.
 *
 * Headless only: never imported by app code (scripts/check-dependency-direction.mjs).
 */
import { INPUT_FIXED_DT_MS } from '../../input/InputFrame';
import { inputHub, type InputSource } from '../../input/InputHub';
import { ScriptedSource, type InputScript } from '../../input/sources/ScriptedSource';
import { simCore } from '../core/SimCore';
import { batchFrameUpdate, useGameStore } from '../../systems/GameState';
import { sampleSimContext, type SimSampleInputs } from '../../experience/simContextSample';
import { resolveActiveEnvelopeInto, triggerOutOfBoundsWipeout } from '../../vehicles/RunnerVehicle/hooks/runnerAirControl';
import { syncRunnerCamera } from '../../vehicles/RunnerVehicle/runnerCameraSync';
import type { SegmentEnvelope } from '../../systems/map/segmentFrames';
import type { RapierBody } from '../../physics/rapierTypes';
import type { HeadlessRun } from './createHeadlessRun';

/** `scriptedRun.ts`'s bias: a hair over zero so frame deltas are never a hair under one step. */
const ACCUMULATOR_BIAS_SEC = 1e-6;

/** An input the hub polls, plus the camera heading it holds (the page's scripted look). */
export interface HeadlessInput {
  readonly source: InputSource;
  /** Camera `[yaw, pitch]` the input holds this frame, or null to leave the camera alone. */
  look(): readonly [number, number] | null;
}

/** A script (the page's `?input=script:` / `?replay=` shape) as a headless input, live from frame 0. */
export function scriptedHeadlessInput(script: InputScript): HeadlessInput {
  const source = new ScriptedSource(script, () => true);
  const heading: [number, number] = [0, 0];
  return {
    source,
    look() {
      const row = source.currentLook();
      if (row) return row;
      if (script.headingYaw === undefined) return null;
      heading[0] = script.headingYaw;
      return heading;
    },
  };
}

export interface StepHeadlessOptions {
  /** Apply queued treadmill / erosion mounts every this many frames (default 1; the browser smokes' cadence is 60). */
  commitEvery?: number;
}

const lifecycleEnvelope: SegmentEnvelope = { yMin: 0, yMax: 0, segmentIndex: null, authored: false };
const sample = {} as SimSampleInputs;

/**
 * Advance `frames` sim frames and return `frames`. A run that finishes the map
 * or wipes out is not a stop here: the caller reads `run.finish` and the store
 * (the page pauses on a finish; so does this, through `ctx.paused`).
 */
export function stepHeadless(run: HeadlessRun, frames: number, input?: HeadlessInput, options: StepHeadlessOptions = {}): number {
  const n = Math.max(0, Math.floor(frames));
  const commitEvery = Math.max(1, Math.floor(options.commitEvery ?? 1));
  if (input && run.input !== input.source) {
    inputHub.registerSource(input.source);
    run.input = input.source;
  }
  const dtSec = INPUT_FIXED_DT_MS / 1000;
  const body = run.body as unknown as RapierBody;
  const wasScripted = simCore.isScripted();
  simCore.setScripted(true);
  try {
    for (let i = 0; i < n; i += 1) {
      const clock = run.clock;
      clock.simTimeSec += dtSec;
      const timestamp = clock.simTimeSec + ACCUMULATOR_BIAS_SEC;
      const delta = timestamp - clock.elapsed;
      clock.elapsed = timestamp;
      clock.frame += 1;

      // −100: the input hub, then the script's camera.
      inputHub.tick(delta * 1000, clock.frame);
      const look = input?.look() ?? null;
      if (look) {
        run.camera.rotation.set(look[1], look[0], 0, 'YXZ');
        run.camera.updateMatrixWorld();
      }

      // −90: SimCore (one fixed step in scripted mode).
      const store = useGameStore.getState();
      sample.input = inputHub.readFrame();
      sample.isPaused = store.isPaused;
      sample.currentSegmentIndex = store.currentSegmentIndex;
      sample.isRaft = false;
      sample.camera = run.camera;
      sample.body = run.body as unknown as SimSampleInputs['body'];
      sampleSimContext(simCore.ctx, sample);
      simCore.advance(delta);

      // 0: the runner's camera follow, once the step reached its camera stage.
      if (run.runnerState.stepScratch.followCamera) syncRunnerCamera(run.camera, body, run.runnerState);

      // 0: the water — field and forces, then the splash disturbances the next frame's field takes.
      run.water.frame(delta, timestamp);
      run.water.splash(body);

      // 0: VehicleTuner's frame (a component on the page, mounted under TrackManager).
      run.tuner.frame(run.body, delta);

      // 0: the treadmill, on the camera the follow just moved.
      const { x, y, z } = run.camera.position;
      const finite = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
      if (finite && simCore.ctx.camera.sane) {
        const result = run.chunk.update(z);
        if (result.poolChanged) run.dirty = true;
      }

      // 0: the lifecycle's mirror and out-of-bounds check.
      lifecycleFrame(run, body);

      if (clock.frame % commitEvery === 0) run.commit();
    }
  } finally {
    simCore.setScripted(wasScripted);
  }
  return n;
}

function lifecycleFrame(run: HeadlessRun, body: RapierBody): void {
  const vel = body.linvel();
  const pos = body.translation();
  const velOk = Number.isFinite(vel.x) && Number.isFinite(vel.z);
  const posOk = Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z);
  if (!velOk) return;
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  const store = useGameStore.getState();
  batchFrameUpdate({ x: posOk ? pos.x : 0, y: posOk ? pos.y : 0, z: posOk ? pos.z : 0 }, speed, store.currentSegmentIndex);
  useGameStore.getState().setDistance(Math.floor((posOk ? Math.abs(pos.z) : 0) * 0.5));
  if (posOk && !useGameStore.getState().isWipeout) {
    const envelope = resolveActiveEnvelopeInto(lifecycleEnvelope, pos);
    if (pos.y < envelope.yMin || pos.y > envelope.yMax) triggerOutOfBoundsWipeout(useGameStore.getState(), envelope);
  }
  void run;
}
