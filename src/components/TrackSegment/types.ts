import type { MutableRefObject, RefObject } from 'react';
import type * as THREE from 'three';
import type { BiomeId } from '../../configs/biomes';
import type { TrackBiomeProfile, TreeSpeciesId } from '../../configs/TrackBiomes';
import type { FlowForecastState } from '../../constants/game';
import type { DecorationPlacement } from '../../systems/MapSystem';

/** Segment kind used by TrackSegment geometry and placement. */
export type SegmentKind = 'normal' | 'waterfall' | 'splash' | 'pond' | 'rapids';

/** Rock archetype used by obstacle / decoration payloads. */
export type RockTypeId = 'boulder' | 'slab' | 'column';

/** Wildflower variant ids from placement helpers. */
export type FlowerVariantId = 'bloom' | 'spike' | 'daisy' | 'bell';

/**
 * Sampled channel cross-section along a segment path.
 * Produced by TrackSegment and consumed by geometry + placement hooks.
 */
export interface ChannelProfileSample {
  t: number;
  worldArc: number;
  leftHalfWidth: number;
  rightHalfWidth: number;
  corridorHalfWidth: number;
  floorDepth: number;
  floorWave: number;
  riffleStrength: number;
  gravelBarSide: 1 | -1;
  undercutSide: 1 | -1;
  flowScale: number;
}

/** Interpolated channel shape at a single path parameter t. */
export interface ChannelShape {
  leftHalfWidth: number;
  rightHalfWidth: number;
  corridorHalfWidth: number;
  floorDepth: number;
  floorWave: number;
  riffleStrength: number;
  gravelBarSide: 1 | -1;
  undercutSide: 1 | -1;
  flowScale: number;
}

/** Narrower shape used by water-surface geometry (subset of ChannelShape). */
export type WaterChannelShape = Pick<
  ChannelShape,
  'leftHalfWidth' | 'rightHalfWidth' | 'corridorHalfWidth'
>;

/** Base transform bag shared by most decoration instances. */
export interface PlacementTransform {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}

/** Mist instances may carry a column/floor variant for shader selection. */
export interface MistPlacement extends PlacementTransform {
  type?: 'floor' | 'column' | string;
}

export interface TreePlacement extends PlacementTransform {
  species?: TreeSpeciesId;
  speciesIndex?: number;
}

export interface FlowerPlacement extends PlacementTransform {
  variant: FlowerVariantId;
  variantIndex: number;
  colorIndex: number;
  hueJitter: number;
  lightnessJitter: number;
}

export interface RockPlacement extends PlacementTransform {
  rockType: RockTypeId;
  color: string;
  crumbling?: boolean;
  segmentId?: number;
  pillarIndex?: number;
}

export interface SandBarPlacement {
  center: THREE.Vector3;
  tangent: THREE.Vector3;
  binormal: THREE.Vector3;
  width: number;
  length: number;
}

/**
 * Full decoration bag returned by usePlacementData.
 * Keys must stay defined (even as empty arrays) to avoid runtime ReferenceErrors.
 */
export interface PlacementData {
  rocks: RockPlacement[];
  scatterRocks: RockPlacement[];
  trees: TreePlacement[];
  cactus: PlacementTransform[];
  desertSage: PlacementTransform[];
  grass: PlacementTransform[];
  canyonGrass: PlacementTransform[];
  wildflowers: FlowerPlacement[];
  reeds: PlacementTransform[];
  driftwood: PlacementTransform[];
  leaves: PlacementTransform[];
  floatingLeaves: PlacementTransform[];
  fireflies: PlacementTransform[];
  birds: PlacementTransform[];
  bats: PlacementTransform[];
  fish: PlacementTransform[];
  pebbles: PlacementTransform[];
  sandBars: SandBarPlacement[];
  mist: MistPlacement[];
  waterLilies: PlacementTransform[];
  sunShafts: PlacementTransform[];
  ferns: PlacementTransform[];
  rapids: PlacementTransform[];
  dragonflies: PlacementTransform[];
  pinecones: PlacementTransform[];
  mushrooms: PlacementTransform[];
  rimTrees: TreePlacement[];
  rockFoam: PlacementTransform[];
  canyonDust: PlacementTransform[];
  icicles: PlacementTransform[];
  iceSheets: PlacementTransform[];
}

/** Mutable placement lists passed into populateZSteps / populateSide. */
export type PlacementLists = {
  [K in keyof PlacementData]: PlacementData[K];
};

export interface PlungeImpactPlacement {
  position: THREE.Vector3;
  intensity: number;
  width: number;
}

export interface TrackSegmentGeometries {
  canyonGeometry: THREE.BufferGeometry | null;
  /** Low-poly U-profile for Rapier trimesh; visual mesh stays collider-free. */
  collisionGeometry: THREE.BufferGeometry | null;
  wallShellGeometry: THREE.BufferGeometry | null;
  waterGeometry: THREE.BufferGeometry | null;
  waterfallPos: THREE.Vector3 | null;
  plungeImpactPlacement: PlungeImpactPlacement | null;
}

/**
 * Config bag forwarded from ChunkManager / map JSON into placement.
 * Density fields may also arrive via segment spread; placement prefers config then profile.
 */
export interface TrackSegmentConfig {
  decorations?: Record<string, number | DecorationPlacement[]>;
  launchShelf?: {
    rockRef: { localX: number; localZ: number; scale: number };
  };
  /** Skip floor trimesh collider (air corridor / broken trestle gap). */
  openFloor?: boolean;
  lodQuality?: 'low' | 'medium' | 'high' | 'ultra' | string;
  particleCount?: number;
  rockDensity?: 'low' | 'medium' | 'high';
  treeDensity?: number;
}

export interface UseGeometriesParams {
  active: boolean;
  segmentPath: THREE.CatmullRomCurve3 | null | undefined;
  pathLength: number;
  segmentId: number;
  type: SegmentKind | string;
  channelProfile: readonly ChannelProfileSample[];
  biomeProfile: TrackBiomeProfile;
  isSlotCanyon: boolean;
  /** Reserved for future geometry/placement coupling; currently unused. */
  placementData?: PlacementData;
  canyonWidth: number;
  waterWidth: number;
  biome: BiomeId | string;
}

/** Biome profile as seen by placement (optional treeDensity override from older maps). */
export type PlacementBiomeProfile = TrackBiomeProfile & {
  treeDensity?: number;
};

export interface UsePlacementDataParams {
  active: boolean;
  segmentPath: THREE.CatmullRomCurve3 | null | undefined;
  segmentId: number;
  type: SegmentKind | string;
  pathLength: number;
  waterWidth: number;
  canyonWidth: number;
  biome: BiomeId | string;
  config?: TrackSegmentConfig | null;
  channelProfile: readonly ChannelProfileSample[];
  bankStartOverride?: number;
  flowSpeed: number;
  biomeProfile: PlacementBiomeProfile;
}

export interface SeedState {
  value: number;
}

/** Shared mutable placement context for populateZSteps / populateSide. */
export interface PopulatePlacementArgs extends PlacementLists {
  zSteps: number;
  geoLength: number;
  segmentPath: THREE.CatmullRomCurve3;
  channelShapeFn: (t: number) => ChannelShape;
  bankStart: number;
  canyonWidth: number;
  waterWidth: number;
  biome: BiomeId | string;
  segmentId: number;
  rng: { next: () => number };
  type: SegmentKind | string;
  config?: TrackSegmentConfig | null;
  flowSpeed: number;
  isSlotCanyon: boolean;
  biomeProfile: PlacementBiomeProfile;
}

export interface PopulateSideArgs extends PlacementLists {
  side: number;
  t: number;
  zLocal: number;
  geoLength: number;
  segmentPath: THREE.CatmullRomCurve3;
  channelShape: ChannelShape;
  bankStart: number;
  canyonWidth: number;
  waterWidth: number;
  waterLevel: number;
  biome: BiomeId | string;
  segmentId: number;
  rng: { next: () => number };
  type: SegmentKind | string;
  config?: TrackSegmentConfig | null;
  flowSpeed: number;
  isSlotCanyon: boolean;
  biomeProfile: PlacementBiomeProfile;
  pathPoint: THREE.Vector3;
  tangent: THREE.Vector3;
  binormal: THREE.Vector3;
  up: THREE.Vector3;
  seedState: SeedState;
  lodQuality: string;
  particleCount: number;
  curvatureStrength: number;
  insideSide: number;
  tNext: number;
  tangentNext: THREE.Vector3;
}

export type SegmentState = FlowForecastState | string;

export interface TrackSegmentProps {
  segmentId?: number;
  type?: SegmentKind | string;
  segmentPath?: THREE.CatmullRomCurve3 | null;
  width?: number;
  waterWidth?: number;
  active?: boolean;
  rockMaterial?: THREE.Material | null;
  biome?: BiomeId | string;
  waterMaterial?: THREE.Material | null;
  flowSpeed?: number;
  config?: TrackSegmentConfig;
  showDebug?: boolean;
  waterLevel?: number;
  segmentState?: SegmentState;
  particleCount?: number;
  particleDensity?: number;
  raftRef?: RefObject<{
    translation: () => { x: number; y: number; z: number };
    linvel?: () => { x: number; y: number; z: number };
  } | null> | null;
  isNight?: boolean;
  flowMap?: THREE.Texture | null;
  verticalBias?: number;
  weatherWetnessRef?: MutableRefObject<number> | null;
  usePooledStaticObstacles?: boolean;
  /** Spread from SegmentData — accepted but not required by the component API. */
  treeDensity?: number;
  rockDensity?: 'low' | 'medium' | 'high' | string;
  rockNormalMap?: THREE.Texture | null;
  points?: THREE.Vector3[];
  cameraShake?: number;
  wallProfile?: TrackBiomeProfile;
  forwardMomentum?: number;
  meanderStrength?: number;
  gravityMultiplier?: number;
  spawns?: unknown;
  id?: number;
}

export interface TrackSegmentMeshesProps {
  segmentId: number;
  type: SegmentKind | string;
  segmentPath: THREE.CatmullRomCurve3 | null | undefined;
  pathLength: number;
  canyonWidth: number;
  waterWidth: number;
  active: boolean;
  rockMaterial: THREE.Material;
  biome: BiomeId | string;
  waterMaterial?: THREE.Material | null;
  flowSpeed: number;
  config?: TrackSegmentConfig;
  showDebug?: boolean;
  placementData: PlacementData;
  canyonGeometry: THREE.BufferGeometry;
  collisionGeometry: THREE.BufferGeometry;
  wallShellGeometry: THREE.BufferGeometry;
  waterGeometry: THREE.BufferGeometry;
  waterfallPos: THREE.Vector3 | null;
  plungeImpactPlacement: PlungeImpactPlacement | null;
  isSlotCanyon: boolean;
  waterLevel: number;
  segmentState: SegmentState;
  particleCount?: number;
  particleDensity?: number;
  raftRef?: TrackSegmentProps['raftRef'];
  isNight?: boolean;
  flowMap?: THREE.Texture | null;
  verticalBias?: number;
  weatherWetnessRef?: MutableRefObject<number> | null;
  usePooledStaticObstacles?: boolean;
}
