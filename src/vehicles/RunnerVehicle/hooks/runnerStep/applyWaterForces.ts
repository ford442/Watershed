/**
 * Stage 6 — applyWaterForces (#559 C, from `RunnerPhysicsStep.ts`):
 * shallow-water running — lower damping and the segment's current along the run.
 */
import { WATER_LEVEL } from '../../../../constants/game';
import { VEHICLE_TUNING } from '../../../../constants/vehicleTuning';
import { getSegmentFlowSpeed } from '../../../../systems/water/segmentFlow';
import type { StepFrame } from './stepFrame';

/** `body.setLinearDamping(f.damping)`, only when it changes (Rapier keeps it). */
function applyBodyDamping(f: StepFrame): void {
  const { s } = f;
  const { body } = f.args;
  if (s.applied.dampingBody === body && s.applied.damping === f.damping) return;
  try {
    body.setLinearDamping(f.damping);
    s.applied.dampingBody = body;
    s.applied.damping = f.damping;
  } catch (_e) { /* damping setter unavailable */ }
}

/** Shallow-water running: lower damping and the segment's current along the run. */
export function applyWaterForces(f: StepFrame): void {
  const { s, dt, pos } = f;
  if (pos.y < WATER_LEVEL + 1.0) {
    f.damping = VEHICLE_TUNING.linearDampingShallowWater;
    applyBodyDamping(f);
    const segFlow = getSegmentFlowSpeed();
    const currentPush = 0.3 * segFlow * dt;
    const im = s.impulse;
    im.x = s.forwardDir.x * currentPush;
    im.y = 0;
    im.z = s.forwardDir.z * currentPush;
    s.applyImpulse('waterCurrent', im);
  } else {
    f.damping = VEHICLE_TUNING.linearDampingAir;
    applyBodyDamping(f);
  }
}
