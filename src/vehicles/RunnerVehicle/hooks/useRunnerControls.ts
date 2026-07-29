import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { updateRunnerPhysics } from './RunnerPhysicsStep';

export function useRunnerControls({
  bodyRef, camera, controls, vehicleState,
  shelfLaunchFiredRef, shelfTriggerRef
}: {
  bodyRef: { current: any };
  camera: any;
  controls: any;
  vehicleState: any;
  shelfLaunchFiredRef: { current: boolean };
  shelfTriggerRef: { current: ReturnType<typeof import('../../utils/shelfLaunch').computeShelfTrigger> };
}) {
  const { world, rapier } = useRapier();

  useFrame((state, delta) => {
    if (!bodyRef.current) return;
    updateRunnerPhysics({
        state, delta, world, body: bodyRef.current, rapier, camera, controls, vehicleState,
        shelfLaunchFiredRef, shelfTriggerRef
    });
  });
}
