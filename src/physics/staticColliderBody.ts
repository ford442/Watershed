/**
 * Build one fixed Rapier body for a StaticColliderSpec (#465 C2). Shared by the
 * Rapier worker and its tests; takes the RAPIER module so the worker keeps the
 * only runtime import of rapier3d-compat in its graph.
 */
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { QuatTuple, StaticColliderSpec } from './rapierWorkerProtocol';

type Rapier = typeof RAPIER_NS;

const quat = (value: QuatTuple) => ({ x: value[0], y: value[1], z: value[2], w: value[3] });

function shapeFor(rapier: Rapier, spec: StaticColliderSpec): RAPIER_NS.ColliderDesc {
  switch (spec.kind) {
    case 'trimesh':
      return rapier.ColliderDesc.trimesh(spec.vertices, spec.indices);
    case 'hull': {
      const hull = rapier.ColliderDesc.convexHull(spec.points);
      if (!hull) throw new Error(`degenerate convex hull (${spec.points.length / 3} points)`);
      return hull;
    }
    default:
      return rapier.ColliderDesc.cuboid(...spec.halfExtents);
  }
}

export function createStaticColliderBody(
  rapier: Rapier,
  world: RAPIER_NS.World,
  spec: StaticColliderSpec,
): RAPIER_NS.RigidBody {
  const desc = shapeFor(rapier, spec);
  if (spec.friction !== undefined) desc.setFriction(spec.friction);
  if (spec.restitution !== undefined) desc.setRestitution(spec.restitution);

  const bodyDesc = rapier.RigidBodyDesc.fixed();
  if (spec.kind !== 'trimesh') {
    bodyDesc.setTranslation(...spec.position);
    if (spec.rotation) bodyDesc.setRotation(quat(spec.rotation));
  }

  const body = world.createRigidBody(bodyDesc);
  world.createCollider(desc, body);
  return body;
}
