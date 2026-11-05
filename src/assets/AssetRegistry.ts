/**
 * AssetRegistry — prop type → authored mesh (+ baked LODs), or the primitive it replaces (#536 A.2).
 *
 * A consumer asks for a prop by its dotted id (`raft.hull.default`, later `rock.boulder`,
 * `trestle.deck`, …). The registry knows which pack owns it, starts that pack's load on the
 * first request, and answers synchronously: the decoded asset once the pack has landed, else
 * null — and the consumer draws today's primitive builder in the meantime. A pack that fails
 * to load (offline, a stale deploy, a manifest mismatch) leaves the primitive in place for the
 * session; nothing a pack does can stop a run.
 *
 * Read-only consumer of the sim: an authored mesh is a visual. Colliders, hull samples and
 * everything a replay hashes come from the code paths they always came from.
 */
import * as THREE from 'three';
import { loadPack, type PackAsset } from './AssetPack';
import type { PackId } from './packManifest';

/** Every prop that has an authored mesh, and the pack that carries it. Adding a prop to a
 *  pack is a source file in assets/src/<pack>/ plus one row here. */
const PROP_PACKS = {
  'raft.hull.default': 'core',
} as const satisfies Record<string, PackId>;

export type AssetProp = keyof typeof PROP_PACKS;

export type AssetStatus = 'idle' | 'loading' | 'ready' | 'failed';

interface PropState {
  status: AssetStatus;
  asset: PackAsset | null;
}

const states = new Map<AssetProp, PropState>();
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

function stateOf(prop: AssetProp): PropState {
  let state = states.get(prop);
  if (!state) {
    state = { status: 'idle', asset: null };
    states.set(prop, state);
  }
  return state;
}

/** Start loading the pack that owns `prop` (idempotent; retries after a failure). */
export function requestAsset(prop: AssetProp): void {
  const state = stateOf(prop);
  if (state.status === 'loading' || state.status === 'ready') return;
  state.status = 'loading';
  const pack = PROP_PACKS[prop];
  loadPack(pack).then(
    (loaded) => {
      const asset = loaded.assets.get(prop) ?? null;
      if (!asset) console.warn(`[assets] pack '${pack}' has no '${prop}'; keeping the primitive`);
      states.set(prop, { status: asset ? 'ready' : 'failed', asset });
      notify();
    },
    (error: unknown) => {
      console.warn(`[assets] pack '${pack}' failed to load; keeping the primitive for '${prop}'`, error);
      states.set(prop, { status: 'failed', asset: null });
      notify();
    },
  );
  notify();
}

/** The decoded asset once its pack has landed, else null (draw the primitive). */
export function getAsset(prop: AssetProp): PackAsset | null {
  return states.get(prop)?.asset ?? null;
}

export function getAssetStatus(prop: AssetProp): AssetStatus {
  return states.get(prop)?.status ?? 'idle';
}

export function subscribeAssets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What a consumer mounts: the object, the material its tint drives, and how to let it go. */
export interface AssetInstance {
  readonly object: THREE.Object3D;
  /** The material a consumer may recolour per frame (the raft's wet-hull tint), or null. */
  readonly tintMaterial: THREE.MeshStandardMaterial | null;
  /** The colour `tintMaterial` has when dry: a tint scales this, never the live colour. */
  readonly dryColor: THREE.Color;
  readonly source: 'pack' | 'primitive';
  dispose(): void;
}

export interface InstantiateOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/**
 * An instance of a decoded asset: a THREE.LOD over clones of its baked levels (geometry shared
 * with the pack, materials cloned so a per-instance tint never bleeds into another instance).
 * `dispose` frees only what the instance owns — the cloned materials; geometry lives with the pack.
 */
export function instantiateAsset(asset: PackAsset, options: InstantiateOptions = {}): AssetInstance {
  const lod = new THREE.LOD();
  lod.name = asset.name;
  const materials = new Map<THREE.Material, THREE.Material>();
  asset.levels.forEach((level, i) => {
    const copy = level.clone(true);
    copy.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = options.castShadow ?? false;
      mesh.receiveShadow = options.receiveShadow ?? false;
      const swap = (m: THREE.Material) => {
        let clone = materials.get(m);
        if (!clone) {
          clone = m.clone();
          materials.set(m, clone);
        }
        return clone;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
    lod.addLevel(copy, asset.entry.lods[i]?.distance ?? 0);
  });
  const tintMaterial =
    [...materials.values()].find((m): m is THREE.MeshStandardMaterial => (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) ??
    null;
  return {
    object: lod,
    tintMaterial,
    dryColor: tintMaterial ? tintMaterial.color.clone() : new THREE.Color(1, 1, 1),
    source: 'pack',
    dispose() {
      for (const material of materials.values()) material.dispose();
    },
  };
}

/** Test seam: forget every prop's state. */
export function resetAssetRegistry(): void {
  states.clear();
  listeners.clear();
}
