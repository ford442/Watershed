/**
 * reachAssetCache.ts — the process-wide cache of streamed Reach assets.
 *
 * Split from ReachStreamer so the track and audio code that only *reads* the cache
 * (TrackManager, WaterFlowForces, ReactiveAudio) does not pull the streamer, its
 * fetch/validate machinery and the manifest loaders into the entry chunk; the
 * streamer loads with the first Reach (`?reach=`) or reach prefetch.
 */

import type * as THREE from 'three';
import type { ReachManifest } from './ReachStreamer';

export interface FlowMapData {
  data: Float32Array;
  width: number;
  height: number;
}

export const AssetCache = {
  textures: new Map<string, THREE.Texture>(),
  noiseTextures: new Map<string, THREE.Texture>(),
  models: new Map<string, THREE.Group>(),
  audioBuffers: new Map<string, AudioBuffer>(),
  shaders: new Map<string, string>(),
  flowMaps: new Map<string, THREE.Texture | THREE.DataTexture>(),
  flowMapData: new Map<string, FlowMapData>(),
  reaches: new Map<string, ReachManifest>(),
};

