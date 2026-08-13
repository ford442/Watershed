export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number];

export interface WorkerRaftState {
  position: Vec3Tuple;
  rotation: QuatTuple;
  velocity: Vec3Tuple;
  angularVelocity: Vec3Tuple;
}

export interface StaticBoxColliderSpec {
  halfExtents: Vec3Tuple;
  position: Vec3Tuple;
  rotation?: QuatTuple;
}

export interface WaterForceTickConfig {
  enabled: boolean;
  flowSpeed: number;
  waterLevel: number;
  raftMass: number;
  raftVolume: number;
  dragCoefficient: number;
  frontalArea: number;
  sideArea: number;
  timeSeconds: number;
  turbulenceStrength: number;
  turbulenceFrequency: number;
  flowDirX: number;
  flowDirZ: number;
  impulseScale?: number;
}

export interface WaterForceDiagnostics {
  source: 'wasm' | 'fallback' | 'disabled';
  forceX: number;
  forceY: number;
  forceZ: number;
  buoyancy: number;
  drag: number;
  flow: number;
  turbulence: number;
  submergedRatio: number;
  /** Wall time of the force batch inside the worker, in microseconds. */
  computeMicros?: number;
}

export interface RapierWorkerInitPayload {
  gravity?: Vec3Tuple;
  raft?: {
    position?: Vec3Tuple;
    halfExtents?: Vec3Tuple;
    mass?: number;
    linearDamping?: number;
    angularDamping?: number;
  };
  staticColliders?: StaticBoxColliderSpec[];
}

export type RapierWorkerCommand =
  | { id: number; type: 'INIT'; payload?: RapierWorkerInitPayload }
  | {
      id: number;
      type: 'STEP';
      delta: number;
      impulses?: Vec3Tuple[];
      waterForce?: WaterForceTickConfig;
    }
  | { id: number; type: 'APPLY_IMPULSE'; impulse: Vec3Tuple; wake?: boolean }
  | { id: number; type: 'GET_STATE' }
  | { id: number; type: 'ADD_STATIC_COLLIDER'; collider: StaticBoxColliderSpec; handle?: number }
  | { id: number; type: 'REMOVE_STATIC_COLLIDER'; handle: number }
  | { id: number; type: 'CLEAR_STATIC_COLLIDERS' };

export type RapierWorkerResponse =
  | {
      id: number;
      type: 'READY';
      state: WorkerRaftState;
      wasmAvailable?: boolean;
      latencyMs?: number;
    }
  | {
      id: number;
      type: 'STATE';
      state: WorkerRaftState;
      waterForce?: WaterForceDiagnostics;
      latencyMs?: number;
    }
  | { id: number; type: 'ACK'; handle?: number; latencyMs?: number }
  | { id: number; type: 'ERROR'; error: string; latencyMs?: number };

export interface RapierWorkerLike {
  postMessage(message: RapierWorkerCommand): void;
  terminate?(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<RapierWorkerResponse>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<RapierWorkerResponse>) => void): void;
}

export const DEFAULT_RAFT_WORKER_INIT: Required<RapierWorkerInitPayload> = {
  gravity: [0, -20, 0],
  raft: {
    position: [0, -4, -10],
    halfExtents: [1, 0.15, 1.5],
    mass: 150,
    linearDamping: 2,
    angularDamping: 2.5,
  },
  staticColliders: [
    {
      position: [0, -4.4, -10],
      halfExtents: [24, 0.2, 160],
    },
  ],
};
