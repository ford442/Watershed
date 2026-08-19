import type { RefObject } from 'react';
import type * as THREE from 'three';
import type { BiomeId } from '../../configs/biomes';
import type { ObstacleSlot } from '../../systems/pools/ObstaclePool';
import type {
  FlowerPlacement,
  MistPlacement,
  PlacementTransform,
  TreePlacement,
} from '../TrackSegment/types';
import { extendTreeMaterial } from '../../utils/TreeShader';
import { extendVegetationMaterial } from '../../utils/VegetationShader';

export type { FlowerPlacement, MistPlacement, PlacementTransform, TreePlacement };

/**
 * Shared placement contract for biome decoration components.
 * Matches TrackSegment placement output (`PlacementTransform` and extensions).
 */
export type BiomeDecorationTransform = PlacementTransform;

export interface BiomeDecorationProps {
  /** Instanced transforms from TrackSegment placement. */
  transforms?: PlacementTransform[];
  /** Segment flow speed — drives wind/scroll rates. */
  flowSpeed?: number;
  /** Player/vehicle speed (scalar, units/sec) for rustle/wake effects. */
  playerVelocityRef?: RefObject<number>;
  /** Slot-canyon segments tighten fog/mist behaviour. */
  isSlotCanyon?: boolean;
  /** Active biome id for palette selection. */
  biome?: BiomeId | string;
}

export interface WeatherAwareDecorationProps extends BiomeDecorationProps {
  /** Optional explicit weather override (defaults to window `weather-update`). */
  weatherType?: string;
}

export interface BatsProps extends BiomeDecorationProps {
  visible?: boolean;
  waterLevel?: number;
}

export interface BirdsProps extends BiomeDecorationProps {
  birdType?: 'songbird' | 'hawk' | string;
  isNight?: boolean;
}

export interface BiomeScopedDecorationProps extends BiomeDecorationProps {
  biome?: BiomeId | string;
}

export interface FoliageProps extends BiomeScopedDecorationProps {
  density?: number;
}

export interface VegetationProps extends Omit<BiomeDecorationProps, 'transforms'> {
  transforms?: TreePlacement[];
  isRim?: boolean;
}

export interface WildflowersProps extends Omit<BiomeScopedDecorationProps, 'transforms'> {
  transforms?: FlowerPlacement[];
}

export interface FallingLeavesProps extends BiomeScopedDecorationProps {
  floating?: boolean;
}

export interface PebblesProps extends BiomeDecorationProps {
  material?: THREE.Material;
}

export interface MistProps extends BiomeDecorationProps {
  transforms?: MistPlacement[];
}

export interface CanyonDustProps extends MistProps {
  count?: number;
  maxDistance?: number;
}

export interface WaterfallSheetProps {
  width?: number;
  height?: number;
  flowSpeed?: number;
  fanAngle?: number;
}

export interface WaterfallParticlesProps {
  count?: number;
  width?: number;
  height?: number;
  playerVelocity?: number;
  particleDensity?: number;
  fanAngle?: number;
}

export interface WaterfallImpactZoneProps {
  width?: number;
  flowSpeed?: number;
  intensity?: number;
  particleDensity?: number;
  playerVelocity?: number;
}

export interface RainbowProps {
  opacity?: number;
  sunDirection?: THREE.Vector3;
}

export interface IceSprayProps {
  origin: THREE.Vector3;
  intensity?: number;
  active?: boolean;
}

export interface FloatingDebrisProps {
  path: THREE.CatmullRomCurve3 | null;
  waterLevel?: number;
  count?: number;
  seed?: number;
}

export interface CanyonBackgroundProps {
  segmentId: number;
  segmentCenter: THREE.Vector3;
  baseColor?: string;
  biome?: BiomeId | string;
}

export interface CanyonDecorationsProps {
  riverPath: THREE.CatmullRomCurve3 | null;
  trackWidth?: number;
  wallHeight?: number;
  segmentSeed?: number;
  wallTightness?: number;
  waterLevel?: number;
  rockDensityBias?: number;
  onRockFoamUpdate?: (foam: PlacementTransform[]) => void;
}

export interface TreeSystemProps {
  riverPath: THREE.CatmullRomCurve3 | null;
  trackWidth?: number;
  wallHeight?: number;
}

export interface PooledObstaclesProps {
  slots: ObstacleSlot[];
  rockMaterial?: THREE.MeshStandardMaterial;
}

/** Rapier rigid-body handle used by splash particle emission. */
export interface SplashParticleTarget {
  translation: () => { x: number; y: number; z: number };
  linvel: () => { x: number; y: number; z: number };
}

export interface SplashParticlesProps {
  target: RefObject<SplashParticleTarget | null>;
  count?: number;
}

/** Shader hook storage on materials using onBeforeCompile. */
export interface MaterialShaderUserData {
  shader?: {
    uniforms: Record<string, { value: unknown }>;
  };
}

export function materialShaderUserData(
  material: THREE.Material,
): MaterialShaderUserData {
  return material.userData as MaterialShaderUserData;
}

export type WeatherUpdateEvent = CustomEvent<{ type?: string }>;

/** Bridge MeshStandardMaterial into VegetationShader without `as any`. */
export type VegetationMaterialInput = NonNullable<
  Parameters<typeof extendVegetationMaterial>[0]
>;

export function toVegetationMaterial(
  mat: THREE.MeshStandardMaterial,
): VegetationMaterialInput {
  return mat as unknown as VegetationMaterialInput;
}

/** Bridge MeshStandardMaterial into TreeShader without `as any`. */
export type TreeMaterialInput = NonNullable<
  Parameters<typeof extendTreeMaterial>[0]
>;

export function toTreeMaterial(mat: THREE.MeshStandardMaterial): TreeMaterialInput {
  return mat as unknown as TreeMaterialInput;
}
