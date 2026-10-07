export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number];

export interface WorkerRaftState {
  position: Vec3Tuple;
  rotation: QuatTuple;
  velocity: Vec3Tuple;
  angularVelocity: Vec3Tuple;
}

/** Surface response; Rapier's defaults (friction 0.5, restitution 0) when unset. */
export interface StaticColliderMaterial {
  friction?: number;
  restitution?: number;
}

export interface StaticBoxColliderSpec extends StaticColliderMaterial {
  /** Omitted = box (the original, only shape). */
  kind?: 'box';
  halfExtents: Vec3Tuple;
  position: Vec3Tuple;
  rotation?: QuatTuple;
}

/** World-space triangle soup — a track segment's canyon collision mesh. */
export interface StaticTrimeshColliderSpec extends StaticColliderMaterial {
  kind: 'trimesh';
  vertices: Float32Array;
  indices: Uint32Array;
}

/** Convex hull of body-local points (scale already applied) — rocks, boulders. */
export interface StaticHullColliderSpec extends StaticColliderMaterial {
  kind: 'hull';
  points: Float32Array;
  position: Vec3Tuple;
  rotation?: QuatTuple;
}

/**
 * The raft worker's static world is the real level, streamed per segment
 * (#465 C2, src/physics/workerColliderRegistry.ts). There is no authored floor.
 */
export type StaticColliderSpec =
  | StaticBoxColliderSpec
  | StaticTrimeshColliderSpec
  | StaticHullColliderSpec;

/** The typed-array buffers a spec can transfer instead of copy. */
export function staticColliderTransferables(spec: StaticColliderSpec): Transferable[] {
  if (spec.kind === 'trimesh') return [spec.vertices.buffer, spec.indices.buffer];
  if (spec.kind === 'hull') return [spec.points.buffer];
  return [];
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
  /**
   * flowSpeed / waterLevel are AUTHORED: the force comes from the sim worker
   * over the hull link (CONNECT_SIM), which samples and stages them on its live
   * SWE field (#455 Phase B). Without a link the tick uses the TS fallback.
   */
  simFlow?: boolean;
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
  /** Set when the sim worker computed it: the flow it sampled at the hull. */
  sampledFlow?: {
    dirX: number;
    dirZ: number;
    speed: number;
    wet: boolean;
    source: 'swe' | 'fallback';
    surfaceOffset: number;
    depth: number;
  };
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
  staticColliders?: StaticColliderSpec[];
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
  | { id: number; type: 'ADD_STATIC_COLLIDER'; collider: StaticColliderSpec; handle?: number }
  | { id: number; type: 'REMOVE_STATIC_COLLIDER'; handle: number }
  | { id: number; type: 'CLEAR_STATIC_COLLIDERS' }
  /** One end of the hull link to the sim worker (src/sim/hullLinkProtocol.ts). Transferred. */
  | { id: number; type: 'CONNECT_SIM'; port: MessagePort };

export type RapierWorkerResponse =
  | {
      id: number;
      type: 'READY';
      state: WorkerRaftState;
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
  postMessage(message: RapierWorkerCommand, transfer?: Transferable[]): void;
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
  // None: an absolute-Y floor does not descend with the centreline (#465 C2).
  staticColliders: [],
};
