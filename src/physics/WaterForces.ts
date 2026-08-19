/**
 * WaterForces.ts — flow-map sampling only.
 *
 * Force *integration* lives in C++ (`calculateWaterForce` /
 * `computeWaterForcesBatch`) and the TypeScript mirror
 * (`calculateWaterForceFallback`). This module samples a CPU flow map so a
 * later path can feed flowDirX/flowDirZ into that ABI. Do not apply impulses
 * from here — that double-applied a second force model on the raft.
 */

import * as THREE from 'three';

export interface FlowMapData {
  /** Normalized flow vectors [u, v] in range [-1, 1] */
  data: Float32Array;
  width: number;
  height: number;
}

/**
 * Sample the flow map at a world-space position.
 *
 * The flow map is assumed to be axis-aligned in the XZ plane and tiled.
 * Returns a normalized 2D flow vector [u, v] where:
 *   u = flow along X (-1 = left, +1 = right)
 *   v = flow along Z (-1 = backward, +1 = forward)
 */
export function sampleFlowMap(
  worldPos: THREE.Vector3,
  flowMap: FlowMapData
): THREE.Vector2 {
  if (!flowMap || !flowMap.data || flowMap.width === 0 || flowMap.height === 0) {
    return new THREE.Vector2(0, -1); // Default downstream flow
  }

  // Wrap coordinates to flow map bounds (tiling)
  const x = ((worldPos.x % flowMap.width) + flowMap.width) % flowMap.width;
  const z = ((worldPos.z % flowMap.height) + flowMap.height) % flowMap.height;

  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;

  // Clamp to valid indices
  const x0 = Math.max(0, Math.min(flowMap.width - 1, ix));
  const x1 = Math.max(0, Math.min(flowMap.width - 1, ix + 1));
  const z0 = Math.max(0, Math.min(flowMap.height - 1, iz));
  const z1 = Math.max(0, Math.min(flowMap.height - 1, iz + 1));

  // Bilinear sample
  const idx00 = (z0 * flowMap.width + x0) * 2;
  const idx10 = (z0 * flowMap.width + x1) * 2;
  const idx01 = (z1 * flowMap.width + x0) * 2;
  const idx11 = (z1 * flowMap.width + x1) * 2;

  const u00 = flowMap.data[idx00];
  const v00 = flowMap.data[idx00 + 1];
  const u10 = flowMap.data[idx10];
  const v10 = flowMap.data[idx10 + 1];
  const u01 = flowMap.data[idx01];
  const v01 = flowMap.data[idx01 + 1];
  const u11 = flowMap.data[idx11];
  const v11 = flowMap.data[idx11 + 1];

  const u =
    u00 * (1 - fx) * (1 - fz) +
    u10 * fx * (1 - fz) +
    u01 * (1 - fx) * fz +
    u11 * fx * fz;

  const v =
    v00 * (1 - fx) * (1 - fz) +
    v10 * fx * (1 - fz) +
    v01 * (1 - fx) * fz +
    v11 * fx * fz;

  return new THREE.Vector2(u, v);
}

export default {
  sampleFlowMap,
};
