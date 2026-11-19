/**
 * useRaftControls — the raft's host half (#577 A.1).
 *
 * The raft's physics is SimCore's `vehicle-raft` (raftSimSystem.ts); this hook
 * registers it for the mount and keeps what a frame draws: the camera follow
 * and FOV (raftCameraSync.ts) and the wet-hull tint. No `useFrame` here steps
 * gameplay.
 */
import { useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { simCore } from '../../../sim/core/SimCore';
import { getComfort } from '../../../systems/settings/comfortRuntime';
import type { RapierBody } from '../../../physics/rapierTypes';
import type { ShelfTrigger } from '../../utils/shelfLaunch';
import { createRaftSimSystem, type RaftWorkerLink } from '../raftSimSystem';
import { createRaftCameraState, syncRaftCamera } from '../raftCameraSync';
import type { RaftMountState } from './useRaftPhysicsState';

export interface UseRaftControlsParams {
  bodyRef: { current: RapierBody | null };
  camera: THREE.Camera;
  mount: RaftMountState;
  /** The Rapier worker's half, or null on main-thread physics. Stable for the mount. */
  worker: RaftWorkerLink | null;
  /** The hull material the wet tint drives and its dry colour (authored mesh or primitive). */
  hullTintRef: { current: { material: THREE.MeshStandardMaterial; dryColor: THREE.Color } | null };
  shelfLaunchFiredRef: { current: boolean };
  shelfTriggerRef: { current: ShelfTrigger | null };
}

/** Darken the hull with how wet it is (submersion + spray at speed). */
function tintWetHull(p: UseRaftControlsParams, body: RapierBody): void {
  const tint = p.hullTintRef.current;
  if (!tint) return;
  const submergedRatio = p.mount.physics.buoyancyState.current.submergedRatio;
  const vel = body.linvel();
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  const wetnessLevel = submergedRatio * 0.6 + (speed > 4 ? Math.min(0.25, (speed - 4) * 0.03) : 0);
  tint.material.color.copy(tint.dryColor).multiplyScalar(1.0 - wetnessLevel * 0.35);
}

export function useRaftControls(params: UseRaftControlsParams): void {
  const [cameraState] = useState(createRaftCameraState);
  const { bodyRef, mount, worker, shelfLaunchFiredRef, shelfTriggerRef } = params;

  useEffect(
    () =>
      simCore.register(
        createRaftSimSystem({
          getBody: () => bodyRef.current,
          state: mount.physics,
          foamParticles: mount.foamParticles,
          shedParticles: mount.shedParticles,
          shelfLaunchFiredRef,
          shelfTriggerRef,
          worker,
        }),
      ),
    [bodyRef, mount, worker, shelfLaunchFiredRef, shelfTriggerRef],
  );

  // Presentation, once per frame after SimCore: the follow and the hull tint.
  useFrame(() => {
    const body = params.bodyRef.current;
    if (!body) return;
    syncRaftCamera(params.camera, body, cameraState, getComfort());
    tintWetHull(params, body);
  });
}
