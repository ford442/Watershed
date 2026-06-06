import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { updateRunnerPhysics } from './RunnerPhysicsStep';

export function useRunnerControls({ bodyRef, camera, controls, vehicleState }) {
  const { world, rapier } = useRapier();

  useFrame((state, delta) => {
    if (!bodyRef.current) return;
    updateRunnerPhysics({
        state, delta, world, body: bodyRef.current, rapier, camera, controls, vehicleState
    });
  });
}
