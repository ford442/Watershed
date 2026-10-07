/// <reference lib="webworker" />
/**
 * The Rapier worker: rigid bodies only. It does not load watershed_native
 * (#455 Phase B) — the raft's native water force is computed by the sim worker
 * on the SWE field it steps and arrives over the hull link (CONNECT_SIM;
 * src/sim/hullLinkProtocol.ts). Without a link it uses the TS fallback on the
 * tick params. Tick order: physicsWorkerWaterForces.ts.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import {
  DEFAULT_RAFT_WORKER_INIT,
  QuatTuple,
  RapierWorkerCommand,
  RapierWorkerInitPayload,
  RapierWorkerResponse,
  StaticBoxColliderSpec,
  Vec3Tuple,
  WaterForceDiagnostics,
  WaterForceTickConfig,
  WorkerRaftState,
} from './rapierWorkerProtocol';
import {
  applyImpulseList,
  applyWaterForceImpulse,
  computePhysicsWorkerWaterForces,
  PHYSICS_WORKER_IMPULSE_SCALE,
} from './physicsWorkerWaterForces';
import { createHullLinkClient, type HullLinkClient, type RapierHullPort } from './hullLinkClient';

let world: RAPIER.World | null = null;
let raftBody: RAPIER.RigidBody | null = null;
let rapierReady: Promise<void> | null = null;
let hullLink: HullLinkClient | null = null;
let nextColliderHandle = 1;
const staticColliderBodies = new Map<number, RAPIER.RigidBody>();

const ctx = self as DedicatedWorkerGlobalScope;

const vec3 = (value: Vec3Tuple) => ({ x: value[0], y: value[1], z: value[2] });

const quat = (value: QuatTuple) => ({
  x: value[0],
  y: value[1],
  z: value[2],
  w: value[3],
});

const ensureRapier = async () => {
  if (!rapierReady) {
    rapierReady = RAPIER.init();
  }
  await rapierReady;
};

const serializeState = (): WorkerRaftState => {
  if (!raftBody) {
    return {
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      velocity: [0, 0, 0],
      angularVelocity: [0, 0, 0],
    };
  }

  const position = raftBody.translation();
  const rotation = raftBody.rotation();
  const velocity = raftBody.linvel();
  const angularVelocity = raftBody.angvel();

  return {
    position: [position.x, position.y, position.z],
    rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
    velocity: [velocity.x, velocity.y, velocity.z],
    angularVelocity: [angularVelocity.x, angularVelocity.y, angularVelocity.z],
  };
};

const createStaticBox = (collider: StaticBoxColliderSpec) => {
  if (!world) return null;

  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(...collider.position);
  if (collider.rotation) {
    bodyDesc.setRotation(quat(collider.rotation));
  }

  const body = world.createRigidBody(bodyDesc);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(...collider.halfExtents),
    body,
  );
  return body;
};

const addStaticCollider = (collider: StaticBoxColliderSpec, requestedHandle?: number) => {
  const body = createStaticBox(collider);
  if (!body) throw new Error('Rapier worker has not been initialized');

  const handle = requestedHandle ?? nextColliderHandle++;
  if (staticColliderBodies.has(handle)) {
    removeStaticCollider(handle);
  }
  staticColliderBodies.set(handle, body);
  if (handle >= nextColliderHandle) {
    nextColliderHandle = handle + 1;
  }
  return handle;
};

const removeStaticCollider = (handle: number) => {
  const body = staticColliderBodies.get(handle);
  if (!body || !world) return;
  world.removeRigidBody(body);
  staticColliderBodies.delete(handle);
};

const clearStaticColliders = () => {
  for (const handle of [...staticColliderBodies.keys()]) {
    removeStaticCollider(handle);
  }
};

const initWorld = async (payload: RapierWorkerInitPayload = {}) => {
  await ensureRapier();

  const raft = {
    ...DEFAULT_RAFT_WORKER_INIT.raft!,
    ...(payload.raft ?? {}),
  };
  const gravity = payload.gravity ?? DEFAULT_RAFT_WORKER_INIT.gravity!;
  const staticColliders = payload.staticColliders ?? DEFAULT_RAFT_WORKER_INIT.staticColliders;

  world?.free?.();
  world = new RAPIER.World(vec3(gravity));
  staticColliderBodies.clear();
  nextColliderHandle = 1;

  for (const collider of staticColliders) {
    const handle = nextColliderHandle++;
    const body = createStaticBox(collider);
    if (body) staticColliderBodies.set(handle, body);
  }

  const [px, py, pz] = raft.position!;
  const [hx, hy, hz] = raft.halfExtents!;
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(px, py, pz)
    .setLinearDamping(raft.linearDamping!)
    .setAngularDamping(raft.angularDamping!);

  raftBody = world.createRigidBody(bodyDesc);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, hy, hz).setMass(raft.mass!),
    raftBody,
  );
};

const applyWaterForcesBeforeStep = (
  delta: number,
  waterForce?: WaterForceTickConfig,
): WaterForceDiagnostics | undefined => {
  if (!raftBody || !waterForce) return undefined;

  // The sim worker's force for the state this tick starts from (posted after
  // the previous step); the TS fallback when there is none or it is stale.
  const fromSim = waterForce.enabled && waterForce.simFlow ? hullLink?.latestForce() ?? null : null;
  const diagnostics = fromSim ?? computePhysicsWorkerWaterForces(serializeState(), waterForce);

  applyWaterForceImpulse(
    raftBody,
    diagnostics,
    delta,
    waterForce.impulseScale ?? PHYSICS_WORKER_IMPULSE_SCALE,
  );

  return diagnostics;
};

const stepWorld = (
  delta: number,
  impulses: Vec3Tuple[] = [],
  waterForce?: WaterForceTickConfig,
): WaterForceDiagnostics | undefined => {
  if (!world) throw new Error('Rapier worker has not been initialized');
  if (!raftBody) throw new Error('Rapier worker raft body is missing');

  const clampedDelta = Math.max(1 / 240, Math.min(delta, 1 / 20));
  const waterDiagnostics = applyWaterForcesBeforeStep(clampedDelta, waterForce);

  if (impulses.length > 0) {
    applyImpulseList(raftBody, impulses);
  }

  world.timestep = clampedDelta;
  world.step();

  if (hullLink && waterForce?.enabled && waterForce.simFlow) {
    hullLink.postHull(serializeState(), waterForce);
  }

  return waterDiagnostics;
};

const respond = (response: RapierWorkerResponse) => {
  ctx.postMessage(response);
};

ctx.addEventListener('message', (event: MessageEvent<RapierWorkerCommand>) => {
  const receivedAt = performance.now();
  const command = event.data;

  const run = async () => {
    switch (command.type) {
      case 'INIT':
        await initWorld(command.payload);
        respond({
          id: command.id,
          type: 'READY',
          state: serializeState(),
          latencyMs: performance.now() - receivedAt,
        });
        return;
      case 'STEP': {
        const diagnostics = stepWorld(command.delta, command.impulses ?? [], command.waterForce);
        respond({
          id: command.id,
          type: 'STATE',
          state: serializeState(),
          waterForce: diagnostics,
          latencyMs: performance.now() - receivedAt,
        });
        return;
      }
      case 'APPLY_IMPULSE':
        if (!raftBody) throw new Error('Rapier worker has not been initialized');
        raftBody.applyImpulse(vec3(command.impulse), command.wake ?? true);
        respond({ id: command.id, type: 'ACK', latencyMs: performance.now() - receivedAt });
        return;
      case 'GET_STATE':
        if (!raftBody) throw new Error('Rapier worker has not been initialized');
        respond({ id: command.id, type: 'STATE', state: serializeState(), latencyMs: performance.now() - receivedAt });
        return;
      case 'ADD_STATIC_COLLIDER': {
        if (!world) throw new Error('Rapier worker has not been initialized');
        const handle = addStaticCollider(command.collider, command.handle);
        respond({ id: command.id, type: 'ACK', handle, latencyMs: performance.now() - receivedAt });
        return;
      }
      case 'REMOVE_STATIC_COLLIDER':
        removeStaticCollider(command.handle);
        respond({ id: command.id, type: 'ACK', latencyMs: performance.now() - receivedAt });
        return;
      case 'CONNECT_SIM':
        hullLink?.close();
        hullLink = createHullLinkClient(command.port as unknown as RapierHullPort);
        respond({ id: command.id, type: 'ACK', latencyMs: performance.now() - receivedAt });
        return;
      case 'CLEAR_STATIC_COLLIDERS':
        clearStaticColliders();
        respond({ id: command.id, type: 'ACK', latencyMs: performance.now() - receivedAt });
        return;
      default:
        throw new Error(`Unknown Rapier worker command: ${(command as RapierWorkerCommand).type}`);
    }
  };

  run().catch((error) => {
    respond({
      id: command.id,
      type: 'ERROR',
      error: error instanceof Error ? error.message : String(error),
      latencyMs: performance.now() - receivedAt,
    });
  });
});

// Best-effort cleanup if the worker is terminated mid-session.
self.addEventListener('close', () => {
  hullLink?.close();
  hullLink = null;
});

export {};
