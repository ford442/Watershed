/**
 * raftHull — the raft's visual hull and its colliders, kept apart on purpose (#536 A.3).
 *
 * The visual is the authored `raft.hull.default` from the `core` pack (a lashed-log raft,
 * assets/src/core/), or, until that pack lands or if it never does, the primitive boxes the
 * raft has always drawn. The colliders are neither: they are declared here, explicitly,
 * as the two cuboids @react-three/rapier used to derive from those primitive boxes
 * (`colliders="cuboid"` makes one collider per child mesh, sized by its bounding box). So the
 * main-thread body has the same shapes, order and offsets whichever visual is mounted, and
 * the worker body keeps its own half-extents (`RaftVehicle` → startRaftWorkerSession).
 */
import * as THREE from 'three';
import { WATER_PHYSICS } from '../../constants/waterPhysics';
import type { AssetInstance } from '../../assets/AssetRegistry';

const W = WATER_PHYSICS.RAFT_WIDTH;
const H = WATER_PHYSICS.RAFT_HEIGHT;
const L = WATER_PHYSICS.RAFT_LENGTH;

/** The primitive deck plate's size and height above the hull centre. */
const DECK_SIZE: readonly [number, number, number] = [W * 0.8, 0.2, L * 0.8];
const DECK_Y = H * 0.5 + 0.1;

export interface RaftCollider {
  readonly halfExtents: readonly [number, number, number];
  readonly position: readonly [number, number, number];
}

/** Hull box, then deck plate — the order the auto-collider pass created them in. */
export const RAFT_HULL_COLLIDERS: readonly RaftCollider[] = [
  { halfExtents: [W / 2, H / 2, L / 2], position: [0, 0, 0] },
  { halfExtents: [DECK_SIZE[0] / 2, DECK_SIZE[1] / 2, DECK_SIZE[2] / 2], position: [0, DECK_Y, 0] },
];

const HULL_DRY_COLOR = new THREE.Color('saddlebrown');

/** Today's raft: a 2 × 0.3 × 3 m box and a darker deck plate. The fallback visual. */
export function buildRaftHullPrimitive(): AssetInstance {
  const group = new THREE.Group();
  group.name = 'raft.hull.primitive';

  const hullGeometry = new THREE.BoxGeometry(W, H, L);
  const hullMaterial = new THREE.MeshStandardMaterial({ color: HULL_DRY_COLOR, roughness: 0.6, metalness: 0.1 });
  const hull = new THREE.Mesh(hullGeometry, hullMaterial);
  hull.castShadow = true;
  hull.receiveShadow = true;

  const deckGeometry = new THREE.BoxGeometry(...DECK_SIZE);
  const deckMaterial = new THREE.MeshStandardMaterial({ color: '#443322' });
  const deck = new THREE.Mesh(deckGeometry, deckMaterial);
  deck.position.set(0, DECK_Y, 0);

  group.add(hull, deck);
  return {
    object: group,
    tintMaterial: hullMaterial,
    dryColor: HULL_DRY_COLOR.clone(),
    source: 'primitive',
    dispose() {
      hullGeometry.dispose();
      hullMaterial.dispose();
      deckGeometry.dispose();
      deckMaterial.dispose();
    },
  };
}
