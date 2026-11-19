/**
 * Physics worker / native water — Rapier + watershed_native: worker state,
 * force path, last batch, SWE displacement, the SWE height thumb (#559 C,
 * from `DebugPanel.tsx`).
 */
import React, { useSyncExternalStore } from 'react';
import { getPhysicsWorkerStatus, subscribePhysicsWorkerStatus } from '../../physics/physicsWorkerRegistry';
import { PHYSICS_WORKER_REASON_LABELS } from '../../utils/physicsWorkerFlag';
import { MetricRow, SectionTitle } from './primitives';
import { SweHeightThumb } from './SweHeightThumb';

export function PhysicsWorkerSection() {
  const physicsWorker = useSyncExternalStore(
    subscribePhysicsWorkerStatus,
    getPhysicsWorkerStatus,
    getPhysicsWorkerStatus,
  );

  return (
    <>
      <SectionTitle>Physics worker — Rapier + watershed_native</SectionTitle>
      <MetricRow
        label="Worker"
        value={
          physicsWorker.active
            ? 'active'
            : physicsWorker.enabled
              ? 'starting'
              : 'off'
        }
        t={physicsWorker.enabled ? (physicsWorker.active ? 'ok' : 'warn') : 'warn'}
        hint={
          physicsWorker.reason
            ? PHYSICS_WORKER_REASON_LABELS[physicsWorker.reason]
            : 'no vehicle mounted yet'
        }
      />
      <MetricRow
        label="Force path"
        value={physicsWorker.path}
        t={physicsWorker.path === 'fallback' ? 'warn' : 'ok'}
        hint={
          physicsWorker.path === 'fallback'
            ? 'watershed_native.wasm did not load — TypeScript force math in use'
            : undefined
        }
      />
      <MetricRow
        label="Last batch"
        value={
          physicsWorker.lastBatchMicros == null
            ? '—'
            : `${physicsWorker.lastBatchMicros} µs`
        }
        t="ok"
      />
      <MetricRow
        label="SWE displacement"
        value={physicsWorker.sweEnabled ? (physicsWorker.sweGrid ?? 'on') : 'off (quality)'}
        t="ok"
      />
      <SweHeightThumb />
    </>
  );
}
