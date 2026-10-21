/**
 * activePad.ts — which gamepad (index into `navigator.getGamepads()`) last
 * produced input (#486 B). Written by the GamepadSource each poll, read by the
 * haptics when a rumble fires. Its own tiny module so neither side has to import
 * the other (and the source stays out of the entry chunk until a pad shows up).
 */

let activePadIndex = -1;

export function getActivePadIndex(): number {
  return activePadIndex;
}

export function setActivePadIndex(index: number): void {
  activePadIndex = index;
}
