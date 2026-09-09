/**
 * VortexForceSystem — Applies centripetal + swirl + downward suction to the
 * player rigid body when inside an authored vortex field (Hydro-Dam chamber).
 *
 * Uses the pure helper in physics/vortexForces.ts so gate strength can be
 * unit-tested without Rapier. Mounted beside WaterFlowForces in TrackManager.
 *
 * Authority (#397): a segment whose swirl is authored as a live `hydroEvents`
 * vortex is already in the SWE `u,w` the hull samples. This system skips those
 * segments rather than stacking a second centripetal field on the same water.
 */

import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  computeVortexForces,
  effectiveVortexStrength,
  resolveVortexConfig,
  type VortexForceConfig,
} from '../../physics/vortexForces';
import type { VortexConfig } from '../map/MapSystem';
import { getAudioManager } from '../audio/AudioSystem';
import { hydroVortexSegments, parseHydroEvents } from './hydroEvents';
import { shouldApplyAuthoredVortexImpulse } from '../../physics/waterForceAuthority';
import { getActiveMap } from '../../maps/registry';
import { getActiveLaunchHour } from '../journey/runSession';

interface VortexForceSystemProps {
  targetRef: React.RefObject<any>;
  segments?: any[];
  enabled?: boolean;
}

const tmpCenter = new THREE.Vector3();
const tmpPoint = new THREE.Vector3();
const tmpBinormal = new THREE.Vector3();
const tmpTangent = new THREE.Vector3();

function resolveVortexCenter(segment: any, authored: VortexConfig): THREE.Vector3 | null {
  const path = segment?.segmentPath as THREE.CatmullRomCurve3 | undefined;
  if (!path) return null;
  const t = typeof authored.centerT === 'number' ? authored.centerT : 0.55;
  path.getPoint(THREE.MathUtils.clamp(t, 0, 1), tmpPoint);
  path.getTangent(THREE.MathUtils.clamp(t, 0, 1), tmpTangent).normalize();
  tmpBinormal.set(-tmpTangent.z, 0, tmpTangent.x).normalize();
  const lateral = authored.lateralOffset ?? 0;
  tmpCenter.copy(tmpPoint).addScaledVector(tmpBinormal, lateral);
  // Keep suction near water surface height of the path sample.
  return tmpCenter;
}

export default function VortexForceSystem({
  targetRef,
  segments = [],
  enabled = true,
}: VortexForceSystemProps) {
  const audioBoostedRef = useRef(false);
  const lastInsideRef = useRef(false);

  const scratchConfig = useMemo<VortexForceConfig>(() => resolveVortexConfig(), []);

  // Live hydroEvent vortices for this run's launch hour. Recomputed per frame
  // is wasteful and per-mount is stale after a map swap, so key it on the map
  // + hour pair the run session already fixes at start.
  const liveHydroVortices = useMemo(() => {
    try {
      const events = parseHydroEvents(getActiveMap().levelData.hydroEvents);
      return hydroVortexSegments(events, getActiveLaunchHour());
    } catch {
      return new Set<number>();
    }
  }, []);

  useFrame((_, delta) => {
    if (!enabled || !targetRef?.current || !segments?.length) return;
    const body = targetRef.current;
    if (typeof body.translation !== 'function') return;

    const translation = body.translation();
    let applied = false;
    let peakStrength = 0;

    for (const segment of segments) {
      const authored = segment?.config?.vortex as VortexConfig | undefined;
      if (!authored || !segment?.segmentPath) continue;
      // One field, one owner — the SWE swirl already reaches the hull.
      if (!shouldApplyAuthoredVortexImpulse(segment?.id, liveHydroVortices)) continue;

      const center = resolveVortexCenter(segment, authored);
      if (!center) continue;

      const config = resolveVortexConfig({
        radius: authored.radius,
        eyeRadius: authored.eyeRadius,
        pullStrength: authored.pullStrength,
        spinStrength: authored.spinStrength,
        downwardForce: authored.downwardForce,
      });
      Object.assign(scratchConfig, config);

      const strength = effectiveVortexStrength(
        segment.segmentState ?? 'Normal',
        segment.flowSpeed,
      );
      peakStrength = Math.max(peakStrength, strength);

      const result = computeVortexForces(
        { x: translation.x, y: translation.y, z: translation.z },
        { x: center.x, y: center.y, z: center.z },
        scratchConfig,
        strength,
      );
      if (!result.inside) continue;

      const dtScale = Math.min(delta, 0.05) * 60;
      if (typeof body.applyImpulse === 'function') {
        body.applyImpulse(
          {
            x: result.force.x * dtScale * 0.016,
            y: result.force.y * dtScale * 0.016,
            z: result.force.z * dtScale * 0.016,
          },
          true,
        );
      } else if (typeof body.addForce === 'function') {
        body.addForce(result.force, true);
      }

      if (typeof body.applyTorqueImpulse === 'function') {
        body.applyTorqueImpulse(
          {
            x: result.torque.x * dtScale * 0.016,
            y: result.torque.y * dtScale * 0.016,
            z: result.torque.z * dtScale * 0.016,
          },
          true,
        );
      } else if (typeof body.addTorque === 'function') {
        body.addTorque(result.torque, true);
      }

      applied = true;
    }

    if (applied !== lastInsideRef.current) {
      lastInsideRef.current = applied;
      try {
        const audio = getAudioManager();
        if (!audio) return;
        if (applied && !audioBoostedRef.current) {
          audio.playSound('rapids_roar', 0.55 + peakStrength * 0.15, 0.72);
          audioBoostedRef.current = true;
        } else if (!applied) {
          audioBoostedRef.current = false;
        }
      } catch {
        // Audio optional in headless / test environments.
      }
    }
  });

  return null;
}
