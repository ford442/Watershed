/**
 * BreakableTrestle — Rapier deck boards across a lumber-flume gap (#399).
 *
 * The flume's trestle used to be scatter geometry with a comment admitting it
 * ("visual only, not breakable"). Each board is now a real body:
 *
 *   kinematicPosition  → stands, carries the player, can be run across
 *   dynamic            → knocked loose above `span.breakSpeed`, falls away
 *
 * Which boards exist at all is the launch hour's business, not this file's:
 * `resolveTrestleSpan` blends the forecast state with the segment's live
 * `hydroEvents[]`, so the flood-hour braid opens a wider hole in the middle of
 * the span than the dawn backwater does, and the existing `openFloor` gap
 * launch is the only way across it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { getAudioManager } from '../../systems/audio/AudioSystem';
import {
  TRESTLE_PLANK_LENGTH,
  TRESTLE_PLANK_THICKNESS,
  type TrestleSpan,
} from '../../systems/lumber/trestleSpan';
import {
  placeTrestlePlanks,
  type TrestlePlankPlacement,
} from '../../systems/lumber/trestlePlacement';
import { emitTrestleBreak } from '../../systems/lumber/trestleBreakEvents';
import { isPlayerRigidBody, vec3FromRapier } from './pillarCrumble';

/** How long a knocked-loose board stays in the world before it is culled. */
const DEBRIS_LIFETIME_S = 6;

/** Impulse scale applied to a board the player knocks out from under itself. */
const BREAK_IMPULSE = 4.5;

export interface BreakableTrestleProps {
  segmentId: number;
  span: TrestleSpan;
  segmentPath: THREE.CatmullRomCurve3 | null | undefined;
  waterLevel: number;
  material?: THREE.Material;
}

interface PlankBodyProps {
  segmentId: number;
  placement: TrestlePlankPlacement;
  breakSpeed: number;
  washout: number;
  material?: THREE.Material;
  onBroken: (plankIndex: number) => void;
}

function PlankBody({
  segmentId,
  placement,
  breakSpeed,
  washout,
  material,
  onBroken,
}: PlankBodyProps) {
  const { rapier } = useRapier();
  const bodyRef = useRef<RapierRigidBody>(null);
  const [broken, setBroken] = useState(false);

  const handleCollisionEnter = useCallback(
    ({
      other,
      manifold,
    }: {
      other: { rigidBody?: RapierRigidBody | null };
      manifold: { solverContactPoint: (i: number) => { x: number; y: number; z: number } };
    }) => {
      if (broken) return;
      const otherBody = other.rigidBody;
      if (!otherBody || !isPlayerRigidBody(otherBody, rapier.RigidBodyType.Dynamic)) return;

      const vel = otherBody.linvel();
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
      // Below the threshold the board holds — that is what makes a dawn deck
      // something you can actually run across.
      if (speed < breakSpeed) return;

      setBroken(true);

      // Send it the way the player was going, plus a little tumble.
      const body = bodyRef.current;
      if (body && typeof body.applyImpulse === 'function') {
        body.applyImpulse(
          { x: vel.x * BREAK_IMPULSE, y: -BREAK_IMPULSE, z: vel.z * BREAK_IMPULSE },
          true,
        );
        body.applyTorqueImpulse?.({ x: vel.z * 0.4, y: 0, z: -vel.x * 0.4 }, true);
      }

      const contact = manifold.solverContactPoint(0);
      getAudioManager()?.playSound(
        'collide_wood',
        0.9,
        0.9,
        new THREE.Vector3(contact.x, contact.y, contact.z),
      );
      emitTrestleBreak({
        segmentIndex: segmentId,
        plankIndex: placement.index,
        impactPoint: vec3FromRapier(contact),
        impactSpeed: speed,
        washout,
      });
    },
    [broken, placement.index, rapier.RigidBodyType.Dynamic, segmentId, breakSpeed, washout],
  );

  // Cull the debris once it has fallen out of play, so a run that smashes the
  // whole deck does not leave twelve dynamic bodies in the solver.
  useEffect(() => {
    if (!broken) return;
    const timer = window.setTimeout(() => onBroken(placement.index), DEBRIS_LIFETIME_S * 1000);
    return () => window.clearTimeout(timer);
  }, [broken, onBroken, placement.index]);

  return (
    <RigidBody
      ref={bodyRef}
      type={broken ? 'dynamic' : 'kinematicPosition'}
      colliders="cuboid"
      friction={0.85}
      restitution={0.05}
      position={[placement.position.x, placement.position.y, placement.position.z]}
      rotation={[0, placement.yaw, 0]}
      onCollisionEnter={handleCollisionEnter}
    >
      <mesh castShadow receiveShadow material={material}>
        <boxGeometry
          args={[placement.width, TRESTLE_PLANK_THICKNESS, TRESTLE_PLANK_LENGTH]}
        />
        {!material && <meshStandardMaterial color="#6b4b2a" roughness={0.92} metalness={0} />}
      </mesh>
    </RigidBody>
  );
}

export default function BreakableTrestle({
  segmentId,
  span,
  segmentPath,
  waterLevel,
  material,
}: BreakableTrestleProps) {
  const placements = useMemo(
    () => placeTrestlePlanks(span, segmentPath, waterLevel),
    [span, segmentPath, waterLevel],
  );

  const [culled, setCulled] = useState<ReadonlySet<number>>(() => new Set<number>());
  const handleBroken = useCallback((plankIndex: number) => {
    setCulled((prev) => {
      if (prev.has(plankIndex)) return prev;
      const next = new Set(prev);
      next.add(plankIndex);
      return next;
    });
  }, []);

  // A recycled segment gets a fresh deck.
  useEffect(() => {
    setCulled(new Set<number>());
  }, [segmentId, span]);

  if (!span.present || placements.length === 0) return null;

  return (
    <group name={`trestle-${segmentId}`}>
      {placements
        .filter((placement) => !culled.has(placement.index))
        .map((placement) => (
          <PlankBody
            key={placement.index}
            segmentId={segmentId}
            placement={placement}
            breakSpeed={span.breakSpeed}
            washout={span.washout}
            material={material}
            onBroken={handleBroken}
          />
        ))}
    </group>
  );
}
