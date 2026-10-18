import { Suspense, useEffect, useState, type ComponentType, type RefObject } from 'react';
import RunnerVehicle from '../vehicles/RunnerVehicle';
import { LazyRaftVehicle, prefetchRaftVehicle } from '../vehicles/raftVehicleChunk';
import { whenIdle } from '../utils/whenIdle';
import { lazyComponent } from '../utils/lazyComponent';
import type { VehicleRigidBodyRef, VehicleType } from './types';

// Debug-only views (`?physicsDebug=1`, the DebugPanel wireframe toggle): not part of play.
const PhysicsDebugOverlay = lazyComponent(() => import('../components/PhysicsDebugOverlay')).Component;
const WireframeDebug = lazyComponent(() => import('../rendering/WireframeDebug')).Component;

interface VehicleMountProps {
  vehicleType: VehicleType;
  vehicleRef: RefObject<VehicleRigidBodyRef | null>;
  wasmWaterTest: boolean;
  physicsDebugEnabled: boolean;
  wireframeDebug: boolean;
  cleanTest: boolean;
}

/** Runner / raft / WASM test vehicle swap inside the physics world. */
export default function VehicleMount({
  vehicleType,
  vehicleRef,
  wasmWaterTest,
  physicsDebugEnabled,
  wireframeDebug,
  cleanTest,
}: VehicleMountProps) {
  // Dev-only harness: a dynamic import behind import.meta.env.DEV so the
  // production bundle carries neither it nor its WASM consumer (#465 C5).
  const [WasmWaterForceTest, setWasmWaterForceTest] =
    useState<ComponentType<{ ref: RefObject<VehicleRigidBodyRef | null> }> | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV || !wasmWaterTest) return;
    let cancelled = false;
    import('../components/WasmWaterForceTest')
      .then((m) => {
        if (!cancelled) setWasmWaterForceTest(() => m.default);
      })
      .catch((err) => console.error('[VehicleMount] Failed to load WasmWaterForceTest:', err));
    return () => {
      cancelled = true;
    };
  }, [wasmWaterTest]);

  // The raft is its own chunk. A runner session fetches it when the main thread is idle, so a
  // later swap (or the delta hand-off) finds it already loaded instead of suspending.
  useEffect(() => {
    if (vehicleType === 'raft') return;
    return whenIdle(prefetchRaftVehicle);
  }, [vehicleType]);

  return (
    <>
      {WasmWaterForceTest ? (
        <WasmWaterForceTest ref={vehicleRef} />
      ) : vehicleType === 'runner' ? (
        <RunnerVehicle ref={vehicleRef} />
      ) : (
        <Suspense fallback={null}>
          <LazyRaftVehicle ref={vehicleRef} />
        </Suspense>
      )}

      {physicsDebugEnabled && (
        <Suspense fallback={null}>
          <PhysicsDebugOverlay enabled={physicsDebugEnabled} vehicleRef={vehicleRef} />
        </Suspense>
      )}
      {wireframeDebug && !cleanTest && (
        <Suspense fallback={null}>
          <WireframeDebug enabled={wireframeDebug} />
        </Suspense>
      )}
    </>
  );
}
