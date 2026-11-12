/**
 * RapierSimStep — registers the Rapier world's step on SimCore (#556 A).
 *
 * Null component mounted first inside `<Physics paused>`: SimCore's
 * `physics-world` system calls the library's `step(SIM_DT)` once per sim step
 * (rapierWorldSimSystem.ts). With the timeStep at the library's default 1/60
 * the accumulator takes `SIM_DT` and steps exactly once — the same single step
 * a scripted frame's biased delta produced.
 */
import { useEffect } from 'react';
import { useRapier } from '@react-three/rapier';
import { simCore } from '../sim/core/SimCore';
import { createRapierWorldSimSystem } from '../physics/rapierWorldSimSystem';

export function RapierSimStep(): null {
  const { step } = useRapier();
  useEffect(() => simCore.register(createRapierWorldSimSystem(step)), [step]);
  return null;
}
