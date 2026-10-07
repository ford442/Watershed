import fs from 'node:fs';
import path from 'node:path';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { createStaticColliderBody } from './staticColliderBody';
import { DEFAULT_RAFT_WORKER_INIT } from './rapierWorkerProtocol';
import { hullSpecFromGeometry, trimeshSpecFromGeometry } from './colliderSpecsFromThree';

/** The worker's world, minus the worker: real Rapier, the streamed shapes. */
function raftWorld() {
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  const raft = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 2, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.15, 1.5).setMass(150), raft);
  return { world, raft };
}

describe('raft worker static world (#465 C2)', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('a streamed track trimesh holds the raft wherever the centreline is (no absolute floor)', () => {
    const { world, raft } = raftWorld();
    // A canyon floor 200 m below the old authored box, as later segments are.
    const floor = new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2).translate(0, -200, 0);
    createStaticColliderBody(RAPIER, world, trimeshSpecFromGeometry(floor));
    raft.setTranslation({ x: 0, y: -198, z: 0 }, true);

    for (let i = 0; i < 120; i += 1) world.step();
    expect(raft.translation().y).toBeGreaterThan(-200.5);
    expect(raft.translation().y).toBeLessThan(-199);
    world.free();
  });

  it('a hull rock blocks the raft', () => {
    const { world, raft } = raftWorld();
    const floor = new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2);
    createStaticColliderBody(RAPIER, world, trimeshSpecFromGeometry(floor));
    createStaticColliderBody(
      RAPIER,
      world,
      hullSpecFromGeometry(new THREE.IcosahedronGeometry(1, 1), {
        position: { x: 0, y: 1, z: -6 },
        scale: { x: 2, y: 2, z: 2 },
      }),
    );
    raft.setTranslation({ x: 0, y: 0.2, z: 0 }, true);
    raft.setLinvel({ x: 0, y: 0, z: -12 }, true);

    for (let i = 0; i < 90; i += 1) world.step();
    expect(raft.translation().z).toBeGreaterThan(-6);
    world.free();
  });

  it('carries no authored absolute-Y floor in the defaults or the raft', () => {
    expect(DEFAULT_RAFT_WORKER_INIT.staticColliders).toEqual([]);
    const raftSource = fs.readFileSync(path.resolve(__dirname, '../vehicles/RaftVehicle.tsx'), 'utf8');
    expect(raftSource).not.toMatch(/LEVEL\s*-\s*0\.65/);
    expect(raftSource).not.toMatch(/staticColliders:\s*\[\s*\{/);
  });
});
