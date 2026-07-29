/**
 * Feature flag for the co-located Rapier + watershed_native physics worker path.
 *
 * Enabled via `?physicsWorker=1` (or legacy `?raftWorker=1`).
 * Default off so visual-smoke and CI stay on main-thread Rapier.
 */
export function isPhysicsWorkerEnabled(search?: string): boolean {
  const raw =
    search ??
    (typeof window !== 'undefined' ? window.location.search : '');
  const params = new URLSearchParams(raw.startsWith('?') ? raw : `?${raw}`);
  return params.get('physicsWorker') === '1' || params.get('raftWorker') === '1';
}
