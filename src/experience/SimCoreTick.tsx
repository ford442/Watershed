/**
 * SimCoreTick — drives SimCore from the R3F frame loop (#521 A).
 *
 * Null component mounted once inside the Canvas, next to the other ticks. At
 * useFrame priority −90 — after the input hub (−100) has produced this frame's
 * InputFrame, before the sun placement (−85) and every default-priority
 * subscriber (the raft, TrackManager, the runner's camera follow) — it samples
 * what the sim reads of the world into `simCore.ctx`, binds the run state
 * (`ctx.game`, the store), then feeds the frame's delta to the core. The
 * Rapier world and the runner step inside the core (`physics-world`,
 * `vehicle-runner`; #556 A).
 *
 * Priority −90 used to belong to WeatherDirectorTick; the weather director is
 * now a SimCore system, so the slot is the core's.
 *
 * The sample is taken before the vehicle's own step this frame, from a body no
 * step has moved since the last one: the numbers are what the vehicle itself
 * reads at the top of its step. A scripted / replay page (`?input=script:` /
 * `?replay=`) steps only through `stepScripted(n)` (input/scriptedRun.ts),
 * which holds the core in scripted mode while it advances n R3F frames, so
 * those frames are n SimCore steps.
 */
import { useEffect, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { DebugStageController } from '../debug/debugStages';
import { inputHub } from '../input/InputHub';
import { simCore } from '../sim/core/SimCore';
import { gameEvents } from '../systems/events/GameEvents';
import { useGameStore } from '../systems/GameState';
import { sampleSweStage } from '../systems/water/sweStageProbe';
import type { VehicleRigidBodyRef } from './types';
import { createSimSystems } from './simSystems';
import { storeSimGame, tapSimDebug } from './simGameBinding';
import { sampleSimContext, type SimSampleInputs } from './simContextSample';

export const SIM_CORE_PRIORITY = -90;

/** The frame's sample argument, rewritten each frame (no per-frame object, #521 D). */
const sample = {} as SimSampleInputs;

export interface SimCoreTickProps {
  debug: DebugStageController;
  vehicleRef: RefObject<VehicleRigidBodyRef | null>;
}

export function SimCoreTick({ debug, vehicleRef }: SimCoreTickProps): null {
  useEffect(() => {
    const offs = createSimSystems(debug).map((system) => simCore.register(system));
    simCore.ctx.water.stageAt = sampleSweStage;
    simCore.ctx.game = storeSimGame;
    simCore.ctx.debug = tapSimDebug;
    const offReset = gameEvents.on('watershed-run-reset', () => simCore.reset());
    return () => {
      offReset();
      for (const off of offs) off();
    };
  }, [debug]);

  useFrame((state, delta) => {
    const store = useGameStore.getState();
    sample.input = inputHub.readFrame();
    sample.isPaused = store.isPaused;
    sample.currentSegmentIndex = store.currentSegmentIndex;
    sample.isRaft = store.vehicleType === 'raft';
    sample.camera = state.camera;
    sample.body = vehicleRef.current;
    sampleSimContext(simCore.ctx, sample);
    simCore.advance(delta);
  }, SIM_CORE_PRIORITY);

  return null;
}
