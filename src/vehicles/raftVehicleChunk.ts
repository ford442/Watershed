/**
 * raftVehicleChunk — the third-person raft (RaftVehicle + its controls and physics runtime,
 * ~90 kB pre-minify) as its own chunk. A runner-only run never mounts it, and the one map
 * that starts on the raft (`preferredVehicle`) fetches it while the menu is up.
 *
 * `VehicleMount` renders `LazyRaftVehicle` inside a Suspense boundary; `prefetchRaftVehicle`
 * is how callers make sure the chunk has landed before a swap, so the swap never shows an
 * empty frame (a vehicle swap mid-run, the delta hand-off).
 *
 * Landing the chunk also starts the authored hull's pack (#536 A.3, `prefetchRaftHull`), so a
 * swap mounts the authored hull on its first frame rather than the primitive. The asset code
 * rides the raft chunk; the entry only carries this `.then`.
 */
import { lazyComponent } from '../utils/lazyComponent';

const raft = lazyComponent(async () => {
  const mod = await import('./RaftVehicle');
  mod.prefetchRaftHull();
  return { default: mod.default };
});

export const LazyRaftVehicle = raft.Component;
export const prefetchRaftVehicle = raft.preload;
