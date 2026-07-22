import type { DebugStageController } from '../debug/debugStages';

/** Rapier rigid-body surface used by runner/raft vehicles and screenshot harness. */
export interface VehicleRigidBodyRef {
  translation: () => { x: number; y: number; z: number };
  linvel: () => { x: number; y: number; z: number };
  rotation?: () => { x: number; y: number; z: number; w: number };
  applyImpulse?: (impulse: { x: number; y: number; z: number }, wake: boolean) => void;
  setTranslation: (pos: { x: number; y: number; z: number }, wake: boolean) => void;
  setLinvel: (vel: { x: number; y: number; z: number }, wake: boolean) => void;
  setAngvel: (vel: { x: number; y: number; z: number }, wake: boolean) => void;
}

export type VehicleType = 'runner' | 'raft';

export interface InnerExperienceProps {
  debug?: DebugStageController;
  physicsDebug?: boolean;
  wireframeDebug?: boolean;
  cleanTest?: boolean;
  /** Active campaign map — shared with StartMenu / URL resolver. */
  mapId?: import('../maps/registry').MapRegistryId;
  /** Called when continue / menu selection changes the active map. */
  onMapChange?: (mapId: import('../maps/registry').MapRegistryId) => void;
  /** Journey-complete → return to StartMenu. */
  onReturnToMenu?: () => void;
}

export interface ExperienceProps extends InnerExperienceProps {
  rendererPreference?: import('../rendering/types').RendererPreference;
}
