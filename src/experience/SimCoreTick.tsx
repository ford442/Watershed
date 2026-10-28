/**
 * SimCoreTick — drives SimCore from the R3F frame loop (#521 A).
 *
 * Null component mounted once inside the Canvas, next to the other ticks. At
 * useFrame priority −90 — after the input hub (−100) has produced this frame's
 * InputFrame, before the sun placement (−85) and every default-priority
 * subscriber (vehicles, Rapier, TrackManager) — it samples what the sim reads
 * of the world into `simCore.ctx`, then feeds the frame's delta to the core.
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
import { simCore, type SimVehicleProbe } from '../sim/core/SimCore';
import { gameEvents } from '../systems/events/GameEvents';
import { useGameStore } from '../systems/GameState';
import { findSegmentFrameAtZ, getSegmentFrames } from '../systems/map/segmentFrames';
import { POSITION_SANE, resolveActiveEnvelopeInto } from '../vehicles/RunnerVehicle/hooks/runnerAirControl';
import type { SegmentEnvelope } from '../systems/map/segmentFrames';
import type { VehicleRigidBodyRef } from './types';
import { createSimSystems } from './simSystems';

export const SIM_CORE_PRIORITY = -90;

/** The camera's envelope, rewritten each frame (no per-frame object). */
const cameraEnvelope: SegmentEnvelope = { yMin: 0, yMax: 0, segmentIndex: null, authored: false };

export interface SimCoreTickProps {
  debug: DebugStageController;
  vehicleRef: RefObject<VehicleRigidBodyRef | null>;
}

/** Fill `probe` from the vehicle's body (the same reads the vehicle and the lifecycle make). */
function sampleVehicle(
  probe: SimVehicleProbe,
  body: VehicleRigidBodyRef | null,
  isRaft: boolean,
  cameraQuaternion: { x: number; y: number; z: number; w: number },
): void {
  probe.valid = false;
  probe.posOk = false;
  probe.isRaft = isRaft;
  if (!body) return;
  const vel = body.linvel?.();
  const pos = body.translation?.();
  if (!vel || !Number.isFinite(vel.x) || !Number.isFinite(vel.z)) return;
  probe.valid = true;
  probe.vx = vel.x;
  probe.vy = vel.y;
  probe.vz = vel.z;
  probe.posOk = Boolean(pos) && Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z);
  if (probe.posOk) {
    probe.x = pos.x;
    probe.y = pos.y;
    probe.z = pos.z;
  }
  // The ghost's pose orientation: the raft's hull, else the first-person camera.
  const q = isRaft && body.rotation ? body.rotation() : cameraQuaternion;
  probe.qx = q.x;
  probe.qy = q.y;
  probe.qz = q.z;
  probe.qw = q.w;
}

export function SimCoreTick({ debug, vehicleRef }: SimCoreTickProps): null {
  useEffect(() => {
    const offs = createSimSystems(debug).map((system) => simCore.register(system));
    const offReset = gameEvents.on('watershed-run-reset', () => simCore.reset());
    return () => {
      offReset();
      for (const off of offs) off();
    };
  }, [debug]);

  useFrame((state, delta) => {
    const ctx = simCore.ctx;
    const store = useGameStore.getState();
    ctx.input = inputHub.readFrame();
    ctx.paused = store.isPaused;
    ctx.segmentIndex = store.currentSegmentIndex;

    // The camera, as TrackManager's per-frame update gated it: finite, and inside
    // the active segment's vertical envelope.
    const { x, y, z } = state.camera.position;
    const finite = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
    const envelope = finite ? resolveActiveEnvelopeInto(cameraEnvelope, state.camera.position) : null;
    ctx.camera.z = z;
    ctx.camera.sane =
      finite &&
      envelope !== null &&
      y >= envelope.yMin &&
      y <= envelope.yMax &&
      Math.abs(x) <= POSITION_SANE.xzMax &&
      Math.abs(z) <= POSITION_SANE.xzMax;
    ctx.segment = findSegmentFrameAtZ(getSegmentFrames(), z);

    sampleVehicle(ctx.vehicle, vehicleRef.current, store.vehicleType === 'raft', state.camera.quaternion);

    simCore.advance(delta);
  }, SIM_CORE_PRIORITY);

  return null;
}

export default SimCoreTick;
