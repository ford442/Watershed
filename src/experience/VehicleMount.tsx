import type { RefObject } from 'react';
import RunnerVehicle from '../vehicles/RunnerVehicle';
import RaftVehicle from '../vehicles/RaftVehicle';
import WasmWaterForceTest from '../components/WasmWaterForceTest';
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
  return (
    <>
      {wasmWaterTest ? (
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
