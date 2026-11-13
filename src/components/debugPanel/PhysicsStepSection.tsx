/**
 * Physics step — Rapier world.step(): avg / p95 / max step, bodies,
 * colliders, active trimesh triangles (#559 C, from `DebugPanel.tsx`).
 */
import React, { useSyncExternalStore } from 'react';
import { getPhysicsPerfMetrics, subscribePhysicsPerfMetrics } from '../../debug/physicsPerfMetrics';
import { MetricRow, SectionTitle, tier } from './primitives';

export function PhysicsStepSection() {
  const physicsPerf = useSyncExternalStore(
    subscribePhysicsPerfMetrics,
    getPhysicsPerfMetrics,
    getPhysicsPerfMetrics,
  );

  return (
    <>
      <SectionTitle>Physics step — Rapier world.step()</SectionTitle>
      <MetricRow
        label="Avg step"
        value={physicsPerf.sampleCount === 0 ? '—' : `${physicsPerf.avgStepMs.toFixed(2)} ms`}
        t={tier(physicsPerf.avgStepMs, 4, 8)}
      />
      <MetricRow
        label="P95 step"
        value={physicsPerf.sampleCount === 0 ? '—' : `${physicsPerf.p95StepMs.toFixed(2)} ms`}
        t={tier(physicsPerf.p95StepMs, 6, 12)}
      />
      <MetricRow
        label="Max step"
        value={physicsPerf.sampleCount === 0 ? '—' : `${physicsPerf.maxStepMs.toFixed(2)} ms`}
        t={tier(physicsPerf.maxStepMs, 8, 16)}
      />
      <MetricRow
        label="Rigid bodies"
        value={String(physicsPerf.rigidBodyCount)}
        t="ok"
      />
      <MetricRow
        label="Colliders"
        value={String(physicsPerf.colliderCount)}
        t="ok"
      />
      <MetricRow
        label="Active trimesh triangles"
        value={physicsPerf.activeCollisionTriangles.toLocaleString()}
        t="ok"
      />
      <div style={{ color: '#888', fontSize: 10, marginBottom: 4 }}>
        ↳ Press O to log current physics-step snapshot in the console
      </div>
    </>
  );
}
