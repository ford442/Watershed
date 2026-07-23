/// <reference lib="webworker" />

import RAPIER from '@dimforge/rapier3d-compat';
import {
  DEFAULT_RAFT_WORKER_INIT,
  QuatTuple,
  RapierWorkerCommand,
  RapierWorkerInitPayload,
  RapierWorkerResponse,
  StaticBoxColliderSpec,
  Vec3Tuple,
  WorkerRaftState,
} from './rapierWorkerProtocol';

let world: RAPIER.World | null = null;
let raftBody: RAPIER.RigidBody | null = null;
let rapierReady: Promise<void> | null = null;

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
  if (!world) return;

  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(...collider.position);
  if (collider.rotation) {
    bodyDesc.setRotation(quat(collider.rotation));
  }

  const body = world.createRigidBody(bodyDesc);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(...collider.halfExtents),
    body
  );
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

  for (const collider of staticColliders) {
    createStaticBox(collider);
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
    raftBody
  );
};

const stepWorld = (delta: number) => {
  if (!world) throw new Error('Rapier worker has not been initialized');
  world.timestep = Math.max(1 / 240, Math.min(delta, 1 / 20));
  world.step();
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
        respond({ id: command.id, type: 'READY', state: serializeState(), latencyMs: performance.now() - receivedAt });
        return;
      case 'STEP':
        stepWorld(command.delta);
        respond({ id: command.id, type: 'STATE', state: serializeState(), latencyMs: performance.now() - receivedAt });
        return;
      case 'APPLY_IMPULSE':
        if (!raftBody) throw new Error('Rapier worker has not been initialized');
        raftBody.applyImpulse(vec3(command.impulse), command.wake ?? true);
        respond({ id: command.id, type: 'ACK', latencyMs: performance.now() - receivedAt });
        return;
      case 'GET_STATE':
        if (!raftBody) throw new Error('Rapier worker has not been initialized');
        respond({ id: command.id, type: 'STATE', state: serializeState(), latencyMs: performance.now() - receivedAt });
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

export {};
