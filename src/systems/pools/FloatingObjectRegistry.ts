/**
 * FloatingObjectRegistry.ts — Global registry for buoyant platform identification
 *
 * RESPONSIBILITIES:
 * - Track which Rapier rigid body handles are floating platforms
 * - Allow player ground-check raycasts to detect platform riding
 *
 * DESIGN:
 * - Simple Set<number> of body handles
 * - FloatingObjectManager registers/unregisters handles on mount/unmount
 * - RunnerVehicle checks registry during ground raycast
 */

/** Set of Rapier RigidBody handles that are floating platforms */
export const floatingPlatformHandles = new Set<number>();

/** Register a body handle as a floating platform */
export function registerFloatingPlatform(handle: number): void {
  floatingPlatformHandles.add(handle);
}

/** Unregister a body handle */
export function unregisterFloatingPlatform(handle: number): void {
  floatingPlatformHandles.delete(handle);
}

/** Check if a body handle belongs to a floating platform */
export function isFloatingPlatform(handle: number | undefined): boolean {
  if (handle === undefined) return false;
  return floatingPlatformHandles.has(handle);
}

/** Clear all registrations (e.g., on level unload) */
export function clearFloatingPlatforms(): void {
  floatingPlatformHandles.clear();
}
