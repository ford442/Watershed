/**
 * rapierTypes.ts — the slice of Rapier the vehicles call, typed once (#503 D).
 *
 * The vehicles used `body: any` / `world: any` / `rapier: any` everywhere, so a
 * misspelt method or a wrong argument shape compiled. Rapier's `RigidBody`
 * (`RapierRigidBody` from @react-three/rapier) satisfies `RapierBody`
 * structurally; tests pass small stubs that implement only this.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface QuatLike extends Vec3Like {
  w: number;
}

/** The rigid-body methods the runner and raft physics call. */
export interface RapierBody {
  readonly handle: number;
  translation(): Vec3Like;
  rotation(): QuatLike;
  linvel(): Vec3Like;
  angvel(): Vec3Like;
  setTranslation(translation: Vec3Like, wakeUp: boolean): void;
  setRotation(rotation: QuatLike, wakeUp: boolean): void;
  setLinvel(velocity: Vec3Like, wakeUp: boolean): void;
  setAngvel(velocity: Vec3Like, wakeUp: boolean): void;
  applyImpulse(impulse: Vec3Like, wakeUp: boolean): void;
  applyTorqueImpulse(torque: Vec3Like, wakeUp: boolean): void;
  setLinearDamping(damping: number): void;
  setBodyType(type: number, wakeUp: boolean): void;
  numColliders(): number;
  collider(index: number): { setFriction(friction: number): void };
  userData?: unknown;
}

/** A Rapier ray hit as the vehicles read it (the method form is Rapier ≥ 0.12). */
export interface RapierRayHit {
  timeOfImpact?: number | (() => number);
  normal?: Vec3Like;
  free?: () => void;
  collider?: {
    parent?: () => { handle?: number; linvel?: () => Vec3Like; free?: () => void } | null;
  };
}

/** Rapier's `Ray`: plain data (`origin`, `dir`) read during a cast. */
export interface RapierRay {
  origin: Vec3Like;
  dir: Vec3Like;
}

export type RapierRayCtor = new (origin: Vec3Like, dir: Vec3Like) => RapierRay;

/** The world queries the vehicles make. Rapier's `World` satisfies it. */
export interface RapierWorldQueries {
  castRay(
    ray: RapierRay,
    maxToi: number,
    solid: boolean,
    filterFlags?: unknown,
    filterGroups?: unknown,
    filterExcludeCollider?: unknown,
    filterExcludeRigidBody?: unknown,
  ): RapierRayHit | null;
  castRayAndGetNormal?(
    ray: RapierRay,
    maxToi: number,
    solid: boolean,
    filterFlags?: unknown,
    filterGroups?: unknown,
    filterExcludeCollider?: unknown,
    filterExcludeRigidBody?: unknown,
  ): RapierRayHit | null;
}

/** The Rapier namespace members the vehicles construct. */
export interface RapierNamespace {
  Ray: RapierRayCtor;
  RigidBodyType: { Dynamic: number; KinematicPositionBased: number };
}
