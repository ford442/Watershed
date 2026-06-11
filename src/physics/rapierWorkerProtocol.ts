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
  | { id: number; type: 'STEP'; delta: number }
  | { id: number; type: 'APPLY_IMPULSE'; impulse: Vec3Tuple; wake?: boolean }
  | { id: number; type: 'GET_STATE' };

export type RapierWorkerResponse =
  | { id: number; type: 'READY'; state: WorkerRaftState; latencyMs?: number }
  | { id: number; type: 'STATE'; state: WorkerRaftState; latencyMs?: number }
  | { id: number; type: 'ACK'; latencyMs?: number }
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
