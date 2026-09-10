/**
 * PhysicsPerfMonitor — R3F component; must be mounted INSIDE <Physics>
 *
 * Times each Rapier world.step() call via useBeforePhysicsStep/useAfterPhysicsStep
 * (these fire immediately around the real `world.step()` call inside
 * @react-three/rapier's own useFrame loop, so this measures the physics
 * engine's own cost, not React/render work happening in the same frame).
 *
 * Samples every SAMPLE_INTERVAL steps and pushes avg/p95/max to the
 * module-level physicsPerfMetrics store so the DOM DebugPanel can read it.
 * Renders nothing (returns null).
 */

import { useRef } from 'react';
import { useBeforePhysicsStep, useAfterPhysicsStep, useRapier } from '@react-three/rapier';
import { updatePhysicsPerfMetrics } from './physicsPerfMetrics';
import { getTotalActiveCollisionTriangles } from './physicsColliderRegistry';

const SAMPLE_INTERVAL = 60; // physics steps between metric snapshots

export default function PhysicsPerfMonitor() {
  const { world } = useRapier();
  const stepStartedAt = useRef(0);
  const samples = useRef<number[]>([]);

  useBeforePhysicsStep(() => {
    stepStartedAt.current = performance.now();
  });

  useAfterPhysicsStep(() => {
    const stepMs = performance.now() - stepStartedAt.current;
    samples.current.push(stepMs);

    if (samples.current.length >= SAMPLE_INTERVAL) {
      const sorted = [...samples.current].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, v) => acc + v, 0);
      const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));

      const snapshot = {
        avgStepMs: Math.round((sum / sorted.length) * 100) / 100,
        p95StepMs: Math.round(sorted[p95Index] * 100) / 100,
        maxStepMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
        sampleCount: sorted.length,
        rigidBodyCount: world.bodies.len(),
        colliderCount: world.colliders.len(),
        activeCollisionTriangles: getTotalActiveCollisionTriangles(),
      };

      updatePhysicsPerfMetrics(snapshot);
      (window as any).__watershedPhysicsPerf = snapshot;

      samples.current = [];
    }
  });

  return null;
}
