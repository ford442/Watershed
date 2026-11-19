/**
 * usePlacementData — the adapter between the packed placement buffer
 * (`terrain/placement.ts`, #487 D) and the 31 Environment components.
 *
 * The buffer is built on the sim worker with the segment's meshes (BUILD_TILE)
 * or here when there is none (`useGeometries`); either way it is the same
 * bytes. This hook only materialises the object shape the components read
 * today, adding the per-instance looks that are pure functions of the index
 * (rock colour / type, tree species, flower variant).
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { isAutumnLike, isSummerLike, type BiomeId } from '../../../configs/biomes';
import type { DecorationPlacement } from '../../../systems/map/MapSystem';
import { getRunSession } from '../../../systems/journey/runSession';
import { ACTIVE_MAP_ID } from '../../../maps/registry';
import {
  auxRockType,
  categoryRange,
  PLACEMENT_CATEGORIES,
  PLACEMENT_STRIDE,
  PlacementAux,
  PlacementField as F,
  readPlacements,
  type PlacementCategory,
} from '../../../terrain/placement/format';
import type { PlacementOverride, PropLayoutSpec, SegmentPlacementInput } from '../../../terrain/placement/inputs';
import { createFlowerPayload, createRockPayload, pickTreeSpecies } from '../utils';
import type {
  PlacementBiomeProfile,
  PlacementData,
  PlacementTransform,
  SegmentKind,
  TrackSegmentConfig,
} from '../types';

// The buffer's categories are exactly PlacementData's keys.
type CategoriesMatch = [PlacementCategory] extends [keyof PlacementData]
  ? [keyof PlacementData] extends [PlacementCategory]
    ? true
    : never
  : never;
const categoriesMatch: CategoriesMatch = true;
void categoriesMatch;

export function emptyPlacementData(): PlacementData {
  return Object.fromEntries(PLACEMENT_CATEGORIES.map((c) => [c, []])) as unknown as PlacementData;
}

const isGlacierBiome = (biome: string, profile: PlacementBiomeProfile | undefined) =>
  profile?.id === 'glacier' || profile?.id === 'glacialMelt'
  || biome === 'glacier' || biome === 'glacial' || biome === 'glacialMelt';

/** The layout flags and densities placement reads, resolved from the biome tables here (the module never imports them). */
export function placementLayoutSpec(opts: {
  type: SegmentKind | string;
  biome: BiomeId | string;
  biomeProfile: PlacementBiomeProfile;
  config?: TrackSegmentConfig | null;
  flowSpeed: number;
}): PropLayoutSpec {
  const { type, biome, biomeProfile, config, flowSpeed } = opts;
  return {
    segmentType: String(type),
    isSlotCanyon: biomeProfile?.id === 'slotCanyon',
    isGlacier: isGlacierBiome(String(biome), biomeProfile),
    isAutumnLike: isAutumnLike(biome),
    isSummerLike: isSummerLike(biome),
    isLumberFlume: biomeProfile?.id === 'lumberFlume' || biome === 'lumberFlume',
    flowSpeed,
    wallHeight: biomeProfile.wallHeight,
    lodQuality: String(config?.lodQuality || 'high'),
    particleCount: config?.particleCount || 100,
    rockDensity: config?.rockDensity ?? biomeProfile?.rockDensity ?? 'low',
    treeDensity: config?.treeDensity ?? biomeProfile?.treeDensity ?? 1,
  };
}

const overridesOf = (def: unknown): PlacementOverride[] | null =>
  Array.isArray(def)
    ? (def as DecorationPlacement[]).map((d) => ({
        localX: d.localX,
        localZ: d.localZ,
        scale: d.scale,
        rotation: d.rotation,
        rockType: d.rockType,
        snap: d.snap,
      }))
    : null;

/** What placement needs beyond the geometry; plain data, so it rides to the worker with the mesh spec. */
export function placementInputFor(opts: {
  type: SegmentKind | string;
  biome: BiomeId | string;
  biomeProfile: PlacementBiomeProfile;
  config?: TrackSegmentConfig | null;
  flowSpeed: number;
}): SegmentPlacementInput {
  return {
    mapId: getRunSession()?.mapId ?? ACTIVE_MAP_ID,
    layout: placementLayoutSpec(opts),
    rocks: overridesOf(opts.config?.decorations?.rocks),
    trees: overridesOf(opts.config?.decorations?.trees),
  };
}

/**
 * The memoised placement input of a segment. Keyed on the config fields
 * placement reads, not on the config object: the input feeds the geometry
 * build context, and a fresh `{}` per render must not rebuild the meshes.
 */
export function usePlacementInput(opts: {
  type: SegmentKind | string;
  biome: BiomeId | string;
  biomeProfile: PlacementBiomeProfile;
  config?: TrackSegmentConfig | null;
  flowSpeed: number;
}): SegmentPlacementInput {
  const { type, biome, biomeProfile, config, flowSpeed } = opts;
  const rocks = config?.decorations?.rocks;
  const trees = config?.decorations?.trees;
  const lodQuality = config?.lodQuality;
  const particleCount = config?.particleCount;
  const rockDensity = config?.rockDensity;
  const treeDensity = config?.treeDensity;
  return useMemo(
    () =>
      placementInputFor({
        type,
        biome,
        biomeProfile,
        config: { decorations: { rocks: rocks ?? 0, trees: trees ?? 0 }, lodQuality, particleCount, rockDensity, treeDensity },
        flowSpeed,
      }),
    [type, biome, biomeProfile, rocks, trees, lodQuality, particleCount, rockDensity, treeDensity, flowSpeed],
  );
}

export interface MaterialiseParams {
  segmentId: number;
  type: SegmentKind | string;
  biome: BiomeId | string;
  biomeProfile: PlacementBiomeProfile;
}

/** The object shape the Environment components read, from a placement buffer. */
export function placementDataFromBuffer(buffer: ArrayBuffer | null, params: MaterialiseParams): PlacementData {
  const out = emptyPlacementData();
  const view = readPlacements(buffer);
  if (!view) return out;
  const { segmentId, type, biome, biomeProfile } = params;
  const rec = view.records;
  const lists = out as unknown as Record<PlacementCategory, unknown[]>;

  for (const category of PLACEMENT_CATEGORIES) {
    const { start, count } = categoryRange(view, category);
    const list = lists[category];
    for (let i = 0; i < count; i += 1) {
      const o = (start + i) * PLACEMENT_STRIDE;
      const aux = rec[o + F.AUX];
      const position = new THREE.Vector3(rec[o + F.PX], rec[o + F.PY], rec[o + F.PZ]);
      if (category === 'sandBars') {
        const tangent = new THREE.Vector3(rec[o + F.RX], rec[o + F.RY], rec[o + F.RZ]);
        const binormal = new THREE.Vector3().crossVectors(tangent, THREE.Object3D.DEFAULT_UP).normalize();
        list.push({ center: position, tangent, binormal, width: rec[o + F.SX], length: rec[o + F.SY] });
        continue;
      }
      const transform: PlacementTransform = {
        position,
        rotation: new THREE.Euler(rec[o + F.RX], rec[o + F.RY], rec[o + F.RZ]),
        scale: new THREE.Vector3(rec[o + F.SX], rec[o + F.SY], rec[o + F.SZ]),
      };
      switch (category) {
        case 'rocks':
        case 'scatterRocks': {
          const rockType = auxRockType(aux);
          const authored = (aux & PlacementAux.AUTHORED) !== 0;
          list.push(createRockPayload({
            ...transform,
            biome,
            segmentId,
            instanceIndex: i,
            isScatter: category === 'scatterRocks',
            nearWall: (aux & PlacementAux.NEAR_WALL) !== 0,
            rockTypeOverride: rockType === 'auto' ? null : rockType,
            crumbling: authored && segmentId === 22 && rockType === 'column',
          }));
          break;
        }
        case 'trees':
        case 'rimTrees':
          list.push({
            ...transform,
            ...pickTreeSpecies({ biomeProfile, biome, isRim: category === 'rimTrees', type, segmentId, instanceIndex: i }),
          });
          break;
        case 'wildflowers':
          list.push(createFlowerPayload({ ...transform, biome, segmentId, instanceIndex: i }));
          break;
        case 'mist':
          list.push({ ...transform, type: (aux & PlacementAux.MIST_COLUMN) !== 0 ? 'column' : 'floor' });
          break;
        default:
          list.push(transform);
      }
    }
  }
  return out;
}

/** Materialise a segment's placement buffer (null while it is still being built: empty lists). */
export function usePlacementData(buffer: ArrayBuffer | null, params: MaterialiseParams): PlacementData {
  const { segmentId, type, biome, biomeProfile } = params;
  return useMemo(
    () => placementDataFromBuffer(buffer, { segmentId, type, biome, biomeProfile }),
    [buffer, segmentId, type, biome, biomeProfile],
  );
}
