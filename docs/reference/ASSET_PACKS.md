# Asset packs (#536)

Authored meshes ship as **packs**: one directory of meshopt-compressed `.glb` files and a
`manifest.json` per pack, built from committed sources at build time. A prop that has an
authored mesh draws today's primitive until its pack lands, and keeps the primitive for the
session if the pack never does. Packs are visuals: colliders, hull samples and everything a
replay hashes come from the code paths they always came from.

Status: **phase A** (the pipeline, the runtime loader, the `core` pack with the raft hull).
Per-biome packs decoded on the sim worker (B), the installable shell (C), the river voice (D)
and #522's content on the pipeline (E) are still open.

## Layout

| Path | What |
|------|------|
| `assets/src/<pack>/<name>.glb` | Authored source (metres, +Y up, forward −Z). Committed. |
| `assets/src/<pack>/<name>.json` | Optional sidecar: the LOD ladder (below). |
| `scripts/build-assets.mjs` | The pipeline: sources → `public/packs/<pack>/`. |
| `public/packs/<pack>/*.glb` + `manifest.json` | Build output. Committed; CI holds it to the sources. |
| `src/assets/packManifest.ts` | The manifest's types and validator (worker-safe). |
| `src/assets/AssetPack.ts` | `loadPack(id)`: fetch, verify, decode (lazy GLTFLoader + MeshoptDecoder). |
| `src/assets/AssetRegistry.ts` | Prop id → pack; `requestAsset` / `getAsset` / `instantiateAsset`. |
| `src/assets/useAssetInstance.ts` | React: the authored instance, or the primitive until it lands. |

The output lives in `public/packs/`, not `public/assets/`: Vite writes its hashed chunks to
`build/assets/`, and `check-build-manifest.mjs` requires every file there to carry a hash.

Asset names are dotted prop ids (`raft.hull.default`, later `rock.boulder`, `trestle.deck`);
the file name is the id. Pack ids are lower-case kebab. `core` carries what any run can need
whatever the biome (vehicles, cosmetics); the biome packs (`glacial`, `lumber`, `meander`,
`hydro`, `delta`) arrive with phase B.

## The pipeline

```bash
pnpm build:assets    # assets/src/ → public/packs/ (also runs at the start of `pnpm build`)
pnpm check:assets    # rebuild in memory, exit 1 if public/packs/ differs (CI)
```

Per source: `dedup` + `weld`, one baked level per sidecar entry (each re-reads the source
and runs meshopt's simplifier at that level's `ratio` / `error`, so no level simplifies a
simplified mesh), then `EXT_meshopt_compression` + `KHR_mesh_quantization`. Each level is a
root child node `lod<N>` (no dots: GLTFLoader strips them from node names).

```json
{ "lods": [ { "distance": 0 },
            { "ratio": 0.45, "error": 0.01, "distance": 14 },
            { "ratio": 0.15, "error": 0.04, "distance": 40 } ] }
```

`distance` is the camera distance (m) from which a level is drawn (`THREE.LOD`); level 0 is
the source at distance 0. No sidecar means one level.

**Reproducible**: sorted inputs, no timestamps, gltf-transform and meshoptimizer pinned to
exact versions in `package.json` (and recorded in each manifest's `tools`). CI's "Asset packs
match their sources" step runs `--check` — the asset twin of the WASM stamp diff. A source
edited without a rebuild, or a hand-edited output, fails it. If a pinned tool is bumped, rebuild
and commit the new bytes in the same PR.

## The manifest

`public/packs/<pack>/manifest.json` (schema 1):

| Field | Meaning |
|-------|---------|
| `pack`, `schema` | Checked against the request; a mismatch is a load failure. |
| `stamp` | sha256 over the pack's assets, 16 hex. Every `.glb` is fetched as `<file>?v=<stamp>`. |
| `assets[name].bytes`, `.sha256` | The runtime rejects bytes that disagree (size always; sha256 where `crypto.subtle` exists). |
| `assets[name].sourceSha256` | Hash of the source `.glb` + sidecar it was built from. |
| `assets[name].bounds` | From the uncompressed source: `min` / `max` / `center` / `radius`. |
| `assets[name].lods` | `{ distance, triangles }` per baked level. |
| `assets[name].textures` | True when the `.glb` carries KTX2 images (the loader then brings KTX2Loader). |

Delivery: the manifest revalidates (`no-cache`); a stamped `.glb` is immutable
(`public/.htaccess`). `check-build-manifest.mjs` (check 5b) fails a build whose manifest
does not describe the files beside it. Every pack file is pinned in its `EXPECTED_PASSENGERS`,
and `--budget` enforces `packMaxBytes` per pack from `build-budget.json`.

## Adding an asset

1. Put `<prop.id>.glb` (and a sidecar if it needs LODs) in `assets/src/<pack>/`. Keep the
   conventions: metres, +Y up, forward −Z, origin where the consumer expects it.
2. `pnpm build:assets`; add the new `public/packs/<pack>/<prop.id>.glb` to
   `EXPECTED_PASSENGERS` in `scripts/check-build-manifest.mjs`.
3. Add the prop id → pack row to `PROP_PACKS` in `src/assets/AssetRegistry.ts`.
4. In the consumer: `useAssetInstance('<prop.id>', buildPrimitive)`, where `buildPrimitive`
   is a module-level function returning today's primitive as an `AssetInstance`. Never derive
   physics from the visual (for the raft, `colliders={false}` + the explicit cuboids in
   `src/vehicles/RaftVehicle/raftHull.ts`).

## The raft hull (phase A.3)

`assets/src/core/raft.hull.default.glb` is written by `scripts/author/raft-hull.mjs` (seven
lashed logs, two cross-beams, a plank seat, one material, colour in `COLOR_0`). It is a
procedural *source*, not a build step: a hull exported from Blender can replace the `.glb` with
no code change. The wet-hull tint scales the instance's own material from its dry colour.

The colliders did not change: `RAFT_HULL_COLLIDERS` is the pair of cuboids
`@react-three/rapier` used to derive from the primitive boxes (pinned by `raftHull.test.ts`),
now declared explicitly so the auto-collider pass can never pick up the authored mesh. The
worker body keeps its own half-extents.

Loading: the hull's pack is requested when the raft chunk lands (the idle prefetch in
`VehicleMount`, or the menu prefetch for a raft-start map), so a swap usually mounts the
authored hull on its first frame. Until then, or if the pack fails, the primitive boxes draw.
