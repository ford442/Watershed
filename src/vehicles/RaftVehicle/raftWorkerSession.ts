/**
 * The raft's Rapier-worker lifecycle, one session per mount (#465 C2/C3).
 *
 * Order:
 * 1. Wait until the track's own collision mesh is registered
 *    (workerColliderRegistry). The worker world has no authored floor, so it
 *    must not start before there is ground under the raft. Until then the
 *    main-thread path owns the raft.
 * 2. INIT the worker at the raft's *current* pose.
 * 3. Replay the registry into the worker and wait for the ACKs.
 * 4. Hand the proxy to the caller (`onReady`), then link the sim worker.
 *
 * Every async continuation checks this session's `stopped` flag and touches
 * only this session's proxy. The old effect read a shared ref, so a toggle or a
 * quick unmount disposed the *new* proxy, or linked a dead one and leaked the
 * unlink handle.
 */
import type { RapierWorkerInitPayload, Vec3Tuple, WorkerRaftState } from '../../physics/rapierWorkerProtocol';
import {
  attachColliderRegistry,
  whenWorkerColliderRegistered,
  type StaticColliderSink,
} from '../../physics/workerColliderRegistry';
import type { SimLinkablePhysics } from '../../sim/linkPhysicsToSim';

/** The slice of RapierWorkerProxy a session drives. */
export interface RaftSessionProxy extends StaticColliderSink, SimLinkablePhysics {
  init(payload?: RapierWorkerInitPayload): Promise<WorkerRaftState>;
  applyImpulse(impulse: Vec3Tuple, wake?: boolean): Promise<void>;
  dispose(): void;
}

/** Registry key prefix of track-segment trimeshes (TrackSegmentCollisionMeshes). */
export const TRACK_COLLIDER_PREFIX = 'seg:';

export interface RaftWorkerSessionOptions<P extends RaftSessionProxy> {
  createProxy: () => P;
  raft: Omit<NonNullable<RapierWorkerInitPayload['raft']>, 'position'>;
  /** Where the raft is when the worker takes over. */
  getRaftPosition: () => Vec3Tuple;
  linkSim: (proxy: P) => () => void;
  onReady: (proxy: P, state: WorkerRaftState) => void;
  onFallback: (error: unknown) => void;
}

export interface RaftWorkerSession<P> {
  readonly proxy: P;
  stop(): void;
}

export function startRaftWorkerSession<P extends RaftSessionProxy>(
  options: RaftWorkerSessionOptions<P>,
): RaftWorkerSession<P> {
  const proxy = options.createProxy();
  let stopped = false;
  let disposed = false;
  let unlinkSim = () => {};
  let detachColliders = () => {};
  const trackWait = whenWorkerColliderRegistered(TRACK_COLLIDER_PREFIX);

  const disposeOnce = () => {
    if (disposed) return;
    disposed = true;
    detachColliders();
    proxy.dispose();
  };

  const run = async () => {
    await trackWait.promise;
    if (stopped) return;

    const state = await proxy.init({
      raft: { ...options.raft, position: options.getRaftPosition() },
      staticColliders: [],
    });
    if (stopped) return;

    const colliders = attachColliderRegistry(proxy);
    detachColliders = colliders.detach;
    await colliders.settled();
    if (stopped) return;

    options.onReady(proxy, state);
    // The raft's water force comes from the sim worker's field (#455 Phase B).
    unlinkSim = options.linkSim(proxy);
  };

  run().catch((error) => {
    if (stopped) return;
    disposeOnce();
    options.onFallback(error);
  });

  return {
    proxy,
    stop: () => {
      if (stopped) return;
      stopped = true;
      trackWait.cancel();
      unlinkSim();
      disposeOnce();
    },
  };
}
