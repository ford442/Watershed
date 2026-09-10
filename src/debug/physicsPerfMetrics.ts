/**
 * physicsPerfMetrics.ts — Shared Rapier physics-step timing store
 *
 * Mirrors the perfMetrics.ts pattern: a module-level store (not Zustand,
 * to avoid re-renders on every physics step) written by PhysicsPerfMonitor
 * (inside <Physics>, via useBeforePhysicsStep/useAfterPhysicsStep) and read
 * by the DOM-level DebugPanel.
 */

export interface PhysicsPerfMetrics {
  /** Rolling average of world.step() wall time, in milliseconds */
  avgStepMs: number;
  /** 95th percentile world.step() time over the current sample window, in milliseconds */
  p95StepMs: number;
  /** Worst-case world.step() time over the current sample window, in milliseconds */
  maxStepMs: number;
  /** Number of physics steps folded into the current sample window */
  sampleCount: number;
  /** Live Rapier rigid body count */
  rigidBodyCount: number;
  /** Live Rapier collider count */
  colliderCount: number;
  /** Sum of triangle counts across all currently-mounted track-segment trimesh colliders */
  activeCollisionTriangles: number;
}

const _metrics: PhysicsPerfMetrics = {
  avgStepMs: 0,
  p95StepMs: 0,
  maxStepMs: 0,
  sampleCount: 0,
  rigidBodyCount: 0,
  colliderCount: 0,
  activeCollisionTriangles: 0,
};

type Listener = () => void;
const _listeners = new Set<Listener>();

/** Read current metrics snapshot */
export function getPhysicsPerfMetrics(): Readonly<PhysicsPerfMetrics> {
  return _metrics;
}

/** Write new metrics and notify subscribers (called from PhysicsPerfMonitor) */
export function updatePhysicsPerfMetrics(partial: Partial<PhysicsPerfMetrics>): void {
  Object.assign(_metrics, partial);
  _listeners.forEach((fn) => fn());
}

/** Subscribe to metric updates. Returns an unsubscribe function. */
export function subscribePhysicsPerfMetrics(fn: Listener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
