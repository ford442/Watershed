/**
 * WaterFlowForces.tsx
 *
 * Comprehensive water flow force system for the Watershed river adventure.
 * - Applies persistent downstream force based on segment flowSpeed
 * - Supports flowMap texture sampling for vector-field currents
 * - Adds turbulence, lateral drift, and centering forces
 * - Dispatches visual/audio events for high-flow rapids
 */

import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleSegmentFlow } from '../utils/segmentSampler';
import { WATER_FLOW_CONFIG } from '../constants/waterFlow';
import { RAFT, WATER_LEVEL } from '../constants/game';
import { AssetCache } from '../systems/ReachStreamer';
import { getAudioManager } from '../systems/AudioSystem';

const tmpPoint = new THREE.Vector3();
const tmpForward = new THREE.Vector3();
const tmpCross = new THREE.Vector3();
const tmpFlowMapForce = new THREE.Vector3();

interface WaterFlowForcesProps {
  targetRef: React.RefObject<any>;
  segments?: any[];
  reachId?: string;
  flowScale?: number;
  enabled?: boolean;
}

function getReachFlowMapUrl(reachId?: string): string | null {
  if (!reachId) return null;
  const manifest = AssetCache.reaches.get(reachId);
  if (!manifest?.requiredAssets?.flowMaps?.length) return null;
  const asset = manifest.requiredAssets.flowMaps[0];
  // Reconstruct the same key used in ReachStreamer
  if (asset.url.startsWith('http://') || asset.url.startsWith('https://') || asset.url.startsWith('/')) {
    return asset.url;
  }
  return `/api/reaches/${reachId}/assets/${asset.url}`;
}

function computeSegmentBounds(segments: any[]): { min: THREE.Vector3; max: THREE.Vector3 } | null {
  if (!segments?.length) return null;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

  for (const seg of segments) {
    if (!seg?.points) continue;
    for (const p of seg.points) {
      min.x = Math.min(min.x, p.x);
      min.y = Math.min(min.y, p.y);
      min.z = Math.min(min.z, p.z);
      max.x = Math.max(max.x, p.x);
      max.y = Math.max(max.y, p.y);
      max.z = Math.max(max.z, p.z);
    }
  }

  // Pad slightly
  const pad = WATER_FLOW_CONFIG.boundsPadding;
  const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
  min.subVectors(center, new THREE.Vector3().subVectors(max, min).multiplyScalar(0.5 * pad));
  max.subVectors(center, new THREE.Vector3().subVectors(min, max).multiplyScalar(-0.5 * pad));

  return { min, max };
}

function sampleFlowMapData(url: string, u: number, v: number): THREE.Vector3 | null {
  const mapData = AssetCache.flowMapData.get(url);
  if (!mapData) return null;

  const { data, width, height } = mapData;
  const x = Math.floor(THREE.MathUtils.clamp(u, 0, 1) * (width - 1));
  const y = Math.floor(THREE.MathUtils.clamp(v, 0, 1) * (height - 1));
  const idx = (y * width + x) * 2;

  return new THREE.Vector3(data[idx], 0, data[idx + 1]);
}

export default function WaterFlowForces({
  targetRef,
  segments = [],
  reachId,
  flowScale = 1,
  enabled = true,
}: WaterFlowForcesProps) {
  const flowFieldRef = useRef({
    version: 1,
    sample: null as {
      time: number;
      point: number[];
      tangent: number[];
      flowSpeed: number;
      state: string;
      turbulence: number;
    } | null,
  });

  const boundsRef = useRef<{ min: THREE.Vector3; max: THREE.Vector3 } | null>(null);
  const flowMapUrlRef = useRef<string | null>(null);
  const lastFlowMapSampleRef = useRef<{ time: number; force: THREE.Vector3 }>({
    time: -9999,
    force: new THREE.Vector3(),
  });

  const audioStateRef = useRef({
    inHighFlow: false,
    lastAudioTime: -9999,
  });

  useMemo(() => {
    flowFieldRef.current.version += 1;
    boundsRef.current = computeSegmentBounds(segments);
    flowMapUrlRef.current = getReachFlowMapUrl(reachId);
  }, [segments, reachId]);

  // Track slipperiness from the current glacier/ice segment
  const slipperinessRef = useRef(0);
  useEffect(() => {
    const onSegmentEnter = (e: CustomEvent) => {
      slipperinessRef.current = e.detail?.slipperiness ?? 0;
    };
    window.addEventListener('segment-enter', onSegmentEnter as EventListener);
    return () => window.removeEventListener('segment-enter', onSegmentEnter as EventListener);
  }, []);

  // Listen for boost events to surge water visuals
  useEffect(() => {
    const onBoost = () => {
      if (flowFieldRef.current.sample) {
        flowFieldRef.current.sample.flowSpeed *= 1.35;
        flowFieldRef.current.sample.turbulence = 1.0;
      }
    };
    window.addEventListener('boost-triggered', onBoost);
    return () => window.removeEventListener('boost-triggered', onBoost);
  }, []);

  useFrame((state, delta) => {
    if (!enabled || !targetRef?.current) return;

    const body = targetRef.current;
    const translation = body.translation();
    tmpPoint.set(translation.x, translation.y, translation.z);

    let closestSample: ReturnType<typeof sampleSegmentFlow> = null;
    let closestDistance = Infinity;

    for (const segment of segments) {
      if (!segment?.active) continue;
      const sample = sampleSegmentFlow(segment, tmpPoint);
      if (!sample) continue;

      if (sample.distance < closestDistance) {
        closestDistance = sample.distance;
        closestSample = sample;
      }
    }

    if (!closestSample || closestDistance > WATER_FLOW_CONFIG.maxInfluenceDistance) return;

    const current = body.linvel();
    tmpForward.set(current.x, 0, current.z);
    const horizontalSpeedSq = tmpForward.lengthSq();
    if (horizontalSpeedSq < 0.0001) {
      tmpForward.set(0, 0, -1);
    } else {
      tmpForward.normalize();
    }

    // ========================================================================
    // 1. Compute flow multipliers based on segment state and flowSpeed
    // ========================================================================
    const rawFlowSpeed = closestSample.flowSpeed ?? 1;
    const segmentState = closestSample.state ?? 'Normal';

    let stateMultiplier = 1;
    if (segmentState === 'Flooded') stateMultiplier = WATER_FLOW_CONFIG.floodedMultiplier;
    else if (segmentState === 'HighFlow') stateMultiplier = WATER_FLOW_CONFIG.rapidsMultiplier;
    else if (rawFlowSpeed < 0.6) stateMultiplier = WATER_FLOW_CONFIG.poolMultiplier;
    else if (rawFlowSpeed > 1.3) stateMultiplier = WATER_FLOW_CONFIG.rapidsMultiplier;

    const effectiveFlowSpeed = Math.max(0.3, rawFlowSpeed * stateMultiplier * flowScale);
    const raftBottom = translation.y - RAFT.HEIGHT * 0.5;
    const submergedRatio = THREE.MathUtils.clamp(
      (WATER_LEVEL - raftBottom) / RAFT.HEIGHT,
      0,
      1
    );

    // ========================================================================
    // 2. Sample flowMap at low frequency for vector-field lateral forces
    // ========================================================================
    const flowMapUrl = flowMapUrlRef.current;
    let flowMapForce = lastFlowMapSampleRef.current.force;

    if (flowMapUrl && state.clock.elapsedTime - lastFlowMapSampleRef.current.time > WATER_FLOW_CONFIG.flowMapSampleInterval) {
      const bounds = boundsRef.current;
      if (bounds) {
        const u = THREE.MathUtils.inverseLerp(bounds.min.z, bounds.max.z, translation.z);
        const v = THREE.MathUtils.inverseLerp(bounds.min.x, bounds.max.x, translation.x);
        const sampled = sampleFlowMapData(flowMapUrl, u, v);
        if (sampled) {
          flowMapForce = sampled.multiplyScalar(WATER_FLOW_CONFIG.lateralStrength * effectiveFlowSpeed);
          lastFlowMapSampleRef.current.force.copy(flowMapForce);
          lastFlowMapSampleRef.current.time = state.clock.elapsedTime;
        }
      }
    }

    // ========================================================================
    // 3. Build downstream force along curve tangent
    // ========================================================================
    const flowCarry =
      rawFlowSpeed < WATER_FLOW_CONFIG.raftNeutralFlowSpeed
        ? WATER_FLOW_CONFIG.raftPondSlowMultiplier
        : rawFlowSpeed > 1.25
          ? WATER_FLOW_CONFIG.raftRapidsCarryMultiplier
          : 1;
    const impulseStrength = effectiveFlowSpeed
      * WATER_FLOW_CONFIG.baseFlowMultiplier
      * WATER_FLOW_CONFIG.raftSubmergedArea
      * WATER_FLOW_CONFIG.raftDragShedding
      * submergedRatio
      * flowCarry;
    const alongFlow = closestSample.tangent.clone().multiplyScalar(impulseStrength * delta * 2.0);

    // ========================================================================
    // 4. Centering / side-slip force (pull toward river centerline)
    // ========================================================================
    const centeringFactor = (closestDistance / Math.max(closestSample.canyonWidth, 1));
    const sideSlip = closestSample.lateral
      .clone()
      .multiplyScalar(centeringFactor * WATER_FLOW_CONFIG.centeringStrength * delta);
    const pondDrag = rawFlowSpeed < WATER_FLOW_CONFIG.raftNeutralFlowSpeed && horizontalSpeedSq > 0.0001
      ? (WATER_FLOW_CONFIG.raftNeutralFlowSpeed - rawFlowSpeed)
        * WATER_FLOW_CONFIG.raftSubmergedArea
        * WATER_FLOW_CONFIG.raftDragShedding
        * delta
      : 0;

    // ========================================================================
    // 5. Turbulence noise force
    // ========================================================================
    const time = state.clock.elapsedTime;
    const turbFreq = WATER_FLOW_CONFIG.turbulenceFrequency;
    const turbAmp = WATER_FLOW_CONFIG.turbulenceAmount * Math.min(effectiveFlowSpeed, 3);
    const turbulenceX = Math.sin(time * turbFreq * 2 + translation.z * 0.1) * Math.cos(time * turbFreq * 1.3) * turbAmp;
    const turbulenceZ = Math.cos(time * turbFreq * 1.7 + translation.x * 0.1) * Math.sin(time * turbFreq * 0.9) * turbAmp;
    const turbulence = new THREE.Vector3(turbulenceX, 0, turbulenceZ).multiplyScalar(delta);

    // ========================================================================
    // 6. Downward pull (keep vehicle seated in water)
    // ========================================================================
    const downwardImpulse = -WATER_FLOW_CONFIG.downwardPull * effectiveFlowSpeed * delta;

    // ========================================================================
    // 7. Apply all forces
    // ========================================================================
    // On glacier ice: reduce lateral resistance and add a persistent slide bias
    // that nudges the raft/runner toward the downstream tangent even without input.
    // slipperiness 0 = no effect; 1 = frictionless chute (reduced by 80% lateral drag).
    const slip = slipperinessRef.current;
    const lateralDampScale = 1.0 - slip * 0.8; // lateral forces attenuated on ice
    const slideBiasX = slip > 0.05 ? closestSample.tangent.x * effectiveFlowSpeed * slip * 0.18 * delta : 0;
    const slideBiasZ = slip > 0.05 ? closestSample.tangent.z * effectiveFlowSpeed * slip * 0.18 * delta : 0;

    const impulseX = alongFlow.x + (flowMapForce.x * delta + sideSlip.x + turbulence.x) * lateralDampScale - tmpForward.x * pondDrag + slideBiasX;
    const impulseZ = alongFlow.z + (flowMapForce.z * delta + sideSlip.z + turbulence.z) * lateralDampScale - tmpForward.z * pondDrag + slideBiasZ;
    if (!isFinite(impulseX) || !isFinite(impulseZ) || !isFinite(downwardImpulse)) return;
    body.applyImpulse(
      { x: impulseX, y: downwardImpulse, z: impulseZ },
      true
    );

    // ========================================================================
    // 8. Alignment torque (vehicle wants to point downstream)
    // ========================================================================
    const alignment = tmpForward.dot(closestSample.tangent);
    const shedFactor = 1 - Math.max(-1, Math.min(1, alignment));
    tmpCross.crossVectors(tmpForward, closestSample.tangent);
    const torqueX = tmpCross.x * shedFactor * impulseStrength * delta * 0.8 * WATER_FLOW_CONFIG.alignmentTorque;
    const torqueY = tmpCross.y * shedFactor * impulseStrength * delta * 1.1 * WATER_FLOW_CONFIG.alignmentTorque;
    const torqueZ = tmpCross.z * shedFactor * impulseStrength * delta * 0.8 * WATER_FLOW_CONFIG.alignmentTorque;
    if (!isFinite(torqueX) || !isFinite(torqueY) || !isFinite(torqueZ)) return;
    body.applyTorqueImpulse(
      { x: torqueX, y: torqueY, z: torqueZ },
      true
    );

    // ========================================================================
    // 9. Expose flow data for shaders / other systems
    // ========================================================================
    const turbulenceLevel = Math.abs(turbulenceX) + Math.abs(turbulenceZ);
    flowFieldRef.current.sample = {
      time: state.clock.elapsedTime,
      point: closestSample.point.toArray(),
      tangent: closestSample.tangent.toArray(),
      flowSpeed: effectiveFlowSpeed,
      state: segmentState,
      turbulence: turbulenceLevel,
    };

    // ========================================================================
    // 10. Audio / visual event dispatch for high-flow zones
    // ========================================================================
    const isHighFlow = effectiveFlowSpeed >= WATER_FLOW_CONFIG.audioThreshold;
    if (isHighFlow && !audioStateRef.current.inHighFlow) {
      audioStateRef.current.inHighFlow = true;
      window.dispatchEvent(
        new CustomEvent('high-flow-entered', {
          detail: { flowSpeed: effectiveFlowSpeed, state: segmentState },
        })
      );
      // One-shot roar audio (throttled)
      const now = state.clock.elapsedTime;
      if (now - audioStateRef.current.lastAudioTime > 4.0) {
        audioStateRef.current.lastAudioTime = now;
        getAudioManager()?.playSound('rapids_roar', Math.min(1, effectiveFlowSpeed / 2.5), 0.95 + Math.random() * 0.1);
      }
    } else if (!isHighFlow && audioStateRef.current.inHighFlow) {
      audioStateRef.current.inHighFlow = false;
      window.dispatchEvent(
        new CustomEvent('high-flow-exited', {
          detail: { flowSpeed: effectiveFlowSpeed, state: segmentState },
        })
      );
    }

    // Continuous dispatch for reactive systems (shaders, UI)
    window.dispatchEvent(
      new CustomEvent('water-flow-update', {
        detail: {
          flowSpeed: effectiveFlowSpeed,
          turbulence: turbulenceLevel,
          state: segmentState,
          point: closestSample.point.toArray(),
        },
      })
    );
  });

  return null;
}
