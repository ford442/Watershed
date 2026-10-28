/**
 * WaterForceRegistry — bodies that receive WASM buoyancy / current-drag each frame.
 *
 * FloatingObjectManager registers debris instances; WaterForceSystem registers
 * the active player vehicle.
 */

export interface WaterForceBody {
  handle?: number;
  translation: () => { x: number; y: number; z: number };
  linvel: () => { x: number; y: number; z: number };
  applyImpulse: (impulse: { x: number; y: number; z: number }, wake: boolean) => void;
  mass?: number;
  volume?: number;
  dragCoefficient?: number;
  frontalArea?: number;
  sideArea?: number;
}

let systemActive = false;

const vehicleBody: { current: WaterForceBody | null } = { current: null };
const floatingBodies = new Map<number, WaterForceBody>();

export function setWaterForceSystemActive(active: boolean): void {
  systemActive = active;
}

export function isWaterForceSystemActive(): boolean {
  return systemActive;
}

/**
 * The SWE field's boot state: 'pending' while a module / worker / grid is
 * still coming up, 'ready' once a grid is installed, 'off' once the session
 * has settled on the analytic surface + TS forces (native init failed,
 * `low` quality, a dead worker). A scripted run waits for it to leave
 * 'pending' (isScriptedReady): forces sample a different field before and
 * after, so going live mid-load makes the run depend on load time.
 */
export type SweReadiness = 'pending' | 'ready' | 'off';

let sweReadiness: SweReadiness = 'pending';

export function setSweReadiness(next: SweReadiness): void {
  sweReadiness = next;
}

export function getSweReadiness(): SweReadiness {
  return sweReadiness;
}

/** True once the field is definitive: ready, off, or no WaterForceSystem mounted at all. */
export function isSweSettled(): boolean {
  return !systemActive || sweReadiness !== 'pending';
}

export function registerVehicleWaterBody(body: WaterForceBody | null): void {
  vehicleBody.current = body;
}

export function registerFloatingWaterBody(handle: number, body: WaterForceBody): void {
  floatingBodies.set(handle, body);
}

export function unregisterFloatingWaterBody(handle: number): void {
  floatingBodies.delete(handle);
}

export function clearFloatingWaterBodies(): void {
  floatingBodies.clear();
}

export function collectWaterForceBodies(): WaterForceBody[] {
  const bodies: WaterForceBody[] = [];
  if (vehicleBody.current) bodies.push(vehicleBody.current);
  floatingBodies.forEach((body) => bodies.push(body));
  return bodies;
}
