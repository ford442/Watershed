/**
 * simContextSample — what SimCore reads of the world at the top of a frame (#556 B).
 *
 * `<SimCoreTick />` (the browser, at useFrame −90) and a headless run
 * (sim/headless/) fill `simCore.ctx` the same way, with this one function: the
 * hub's frame, the run state's pause / segment, the camera's sanity gate and
 * the segment frame under it, the vehicle probe, and what the sim reads of the
 * water. Moved out of SimCoreTick unchanged so a headless step cannot drift
 * from the page's.
 */
import type { InputFrame } from '../input/InputFrame';
import type { SimContext, SimVehicleProbe } from '../sim/core/SimCore';
import { findSegmentFrameAt, getSegmentFrames } from '../systems/map/segmentFrames';
import type { SegmentEnvelope } from '../systems/map/segmentFrames';
import { getActiveLaunchHour, getRunMap } from '../systems/journey/runSession';
import { parseHydroEvents, type HydroEvent } from '../systems/water/hydroEvents';
import { POSITION_SANE, resolveActiveEnvelopeInto } from '../vehicles/RunnerVehicle/hooks/runnerAirControl';
import type { VehicleRigidBodyRef } from './types';

/** The camera's envelope, rewritten each frame (no per-frame object). */
const cameraEnvelope: SegmentEnvelope = { yMin: 0, yMax: 0, segmentIndex: null, authored: false };

/** The run map's parsed hydro events, re-parsed only when the authored list changes (a map advance). */
const hydroCache: { raw: unknown; parsed: readonly HydroEvent[] } = { raw: undefined, parsed: [] };

function runHydroEvents(): readonly HydroEvent[] {
  const raw = getRunMap().levelData.hydroEvents;
  if (raw !== hydroCache.raw) {
    hydroCache.raw = raw;
    hydroCache.parsed = parseHydroEvents(raw);
  }
  return hydroCache.parsed;
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

export interface SimSampleCamera {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
}

export interface SimSampleInputs {
  input: Readonly<InputFrame>;
  isPaused: boolean;
  currentSegmentIndex: number;
  isRaft: boolean;
  camera: SimSampleCamera;
  body: VehicleRigidBodyRef | null;
}

/** Fill `ctx` for this frame. Reads the module-level segment frames and the run session. */
export function sampleSimContext(ctx: SimContext, s: SimSampleInputs): void {
  ctx.input = s.input;
  ctx.paused = s.isPaused;
  ctx.segmentIndex = s.currentSegmentIndex;

  // The camera, as TrackManager's per-frame update gated it: finite, and inside
  // the active segment's vertical envelope.
  const { x, y, z } = s.camera.position;
  const finite = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
  const envelope = finite ? resolveActiveEnvelopeInto(cameraEnvelope, s.camera.position) : null;
  ctx.camera.z = z;
  ctx.camera.sane =
    finite &&
    envelope !== null &&
    y >= envelope.yMin &&
    y <= envelope.yMax &&
    Math.abs(x) <= POSITION_SANE.xzMax &&
    Math.abs(z) <= POSITION_SANE.xzMax;
  ctx.segment = findSegmentFrameAt(getSegmentFrames(), s.camera.position);

  sampleVehicle(ctx.vehicle, s.body, s.isRaft, s.camera.quaternion);
  ctx.water.launchHour = getActiveLaunchHour();
  ctx.water.hydroEvents = runHydroEvents();
}
