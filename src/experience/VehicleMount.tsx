import { useEffect, useState, type ComponentType, type RefObject } from 'react';
import RunnerVehicle from '../vehicles/RunnerVehicle';
import RaftVehicle from '../vehicles/RaftVehicle';
import PhysicsDebugOverlay from '../components/PhysicsDebugOverlay';
import WireframeDebug from '../rendering/WireframeDebug';
import type { VehicleRigidBodyRef, VehicleType } from './types';

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

  return (
    <>
      {WasmWaterForceTest ? (
        <WasmWaterForceTest ref={vehicleRef} />
      ) : vehicleType === 'runner' ? (
        <RunnerVehicle ref={vehicleRef} />
      ) : (
        <RaftVehicle ref={vehicleRef} />
      )}

      {physicsDebugEnabled && (
        <PhysicsDebugOverlay enabled={physicsDebugEnabled} vehicleRef={vehicleRef} />
      )}
      {wireframeDebug && !cleanTest && <WireframeDebug enabled={wireframeDebug} />}
    </>
  );
}
