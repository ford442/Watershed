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
