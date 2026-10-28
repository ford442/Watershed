# Decoration placement from the terrain tile — seeded per (map, segment), worker parity, bank-aware (#487 D; unblocks #522 C)

Expanded 2026-10-28 from the Dispatch-B draft in `notes/dispatch-2026-10-28.md` and three reviews (Gemini Pro: file-level plan; gpt-oss-120b: stress test + two alternatives; Grok: ecosystem currency), **reconciled against `main` `e875a7c`**. Where a review named a file that does not exist, the real one is given; where two reviews disagreed, the tree decided. The adjudication table is at the end.

## Why (verified in the tree)

1. **Heights follow a hand-written curve, not the tile.** `src/components/TrackSegment/hooks/populateSidePart1.ts:39,138,202,281,302,364` and `populateSidePart2.ts` compute `groundY = Math.pow(normalizedDist, 2.5) * 12`, clamp it at 25 and add `+0.1` ("slightly embedded"), `+0.3` ("slight float"), `-0.5`. The canyon that is actually rendered and collided with comes from `canyonFloorFromShape` (`src/terrain/terrainTile.ts:240`) plus the tube fold (`applyTubeProfile`), the slot lift (`TERRAIN_SLOT_FLOOR_LIFT`), rock noise and erosion (#487 E). Two different curves; the props follow the wrong one. That is the floating at the bank and the sinking in the tube.
2. **Lateral positions are fractions of the canyon width, not the bank.** `populateZSteps.ts:75-76,130`: `side * canyonWidth * 0.44` / `0.72`, `bankStart + 4 + rng() * 4`. The tile knows where the wetted channel ends (`tile.bank`, `bankHalfWidth`); placement never asks.
3. **The seed is the segment index alone.** `usePlacementData.ts:71`: `createRng(segmentId)`. Segment 7 of every map draws the same stream. `forkSeed(seed, label)` (`src/math/random.ts:90`) exists and is unused here. #522 C wants stones seeded per map and per daily seed; impossible as is.
4. **Placement is main-thread only and object-shaped.** `PlacementData` is 31 category arrays (`rocks`, `scatterRocks`, `trees`, `grass`, … `iceSheets`) of `{ position: THREE.Vector3, rotation: THREE.Euler, scale }`, built in a `useMemo` on mount. `useGeometries.ts:100` already receives the segment's *meshes* from the sim worker (`BUILD_TILE` with a `SegmentMeshSpec`, stale replies dropped by `tile.ctx === buildCtx`), but placement does not ride along, so a treadmill append still runs all 31 categories on the main thread.
5. **There is no sampler.** `terrainTile.ts` exports the per-vertex planes (`X`, `H`, `BANK`, `SLOPE_X`, `SLOPE_Z`) and `sampleChannelShape` / `samplePackedChannelShape` (the channel profile only). Nothing answers "height, normal and band at `(s, lateral)`". `src/vehicles/utils/shelfLaunch.ts:59` and `src/systems/map/segmentFrames.ts` each re-derive positions from `segmentPath.getPoint(t) + binormal * localX`.
6. **Authored overrides have no height and no snap flag.** `DecorationPlacement` (`src/systems/map/MapSystem.types.ts:50`) is `{ localX, localZ, scale?, rotation?, rockType? }`; the schema is `src/formats/level.schema.json:428`. Slabs and columns (`meander_to_waterfall.json`, `delta_rapids.json`, `lumber_flume.json`, `glacial_source.json`) inherit the same guessed Y.
7. **Instanced bounds are never recomputed.** `src/components/Obstacles/Rock.tsx` builds `InstancedRigidBodies` from the object transforms (keys `rock-${rockType}-${i}`) and writes `instanceMatrix`; no `computeBoundingSphere()` follows, so frustum culling runs on the geometry's untransformed sphere.

## Later picture

One sampler on the tile, `sampleTile(tile, s01, lateral, out) → { y, nx, ny, nz, band }` with `band ∈ floor | bank | wall | rim | crown`, measured in the tile's own datum and never in absolute Y. Every placement, every authored override, #522 C's risky-line tags and, later, the launch-shelf trigger read the same function. Placement is a pure function of `(tile, segment frame, layout spec, seed)` that produces the same bytes on the main thread and the sim worker, exactly as the mesh build already does. Baking that function's output to data stays a one-step derivative if cross-engine identity is ever required (challenge files raced on another machine, #522 E); it is not required for same-browser parity, which is the guarantee the tree already makes for the tile.

## New libraries / includes

None. Considered and rejected:
- **`BatchedMesh` for mixed props** — Grok: one `InstancedMesh` per geometry is still the right shape for a few geometries with many instances; `BatchedMesh` is for many *different* geometries. Nothing in r185/r186 changes how `InstancedMesh` is fed.
- **Rapier raycast snapping** (gpt-oss alternative C) — physics runs in a worker here, and a BVH traversal order is a new nondeterminism source; the tile is the ground truth and is already in hand.
- **Baked placement blobs per map** (gpt-oss alternative B) — solves cross-browser byte identity, which this repo does not gate on, and loses the per-day seed #522 C needs. Kept as a derivative: the same function run at build time emits the blob.

## Phases

### A — The sampler (`src/terrain/terrainTile.ts`, three-free)
1. `sampleTile(tile, s01, lateral, out)`: bilinear over the plane grid in `(row, x)`. `x` is per-vertex and, above `curl ≈ 2/3`, non-monotone (the overhang), so a lateral query inside the fold picks the **floor branch** (lowest `h`) and reports `crown` for the fold above it. `out` is a caller-owned scratch object; the sampler allocates nothing.
2. `sampleBand(tile, s01, lateral)`: `floor` (inside `bankHalfWidth`), `bank` (`tile.bank === 1` and `slopeX` below the wall threshold), `wall`, `rim` (the top row of the open profile / wall shell), `crown` (tube fold). Thresholds live next to `TerrainProfile`, per profile.
3. Tests in `src/terrain/__tests__/`: at grid nodes the sample equals the vertex within 1e-5; the result is invariant under a rigid vertical translation of the whole segment; normals are unit; an ice-tube segment returns `crown` above and `floor` below at the same lateral; the slot profile's lift is included.

### B — The placement module (`src/terrain/placement.ts`, three-free)
1. `buildSegmentPlacements(tile, frame, spec, seed, overrides) → PlacementBuffers`: **one packed `ArrayBuffer`** per segment with a small offsets table per category (`positions ×3`, `normals ×3`, `yaw`, `scale`, `type`, `countsByCategory`). Gemini's point: one transferable, not twenty.
2. `PropLayoutSpec` extracted from `populateZSteps` / `populateSidePart1` / `populateSidePart2`: per category a band mask, a lateral range in **bank units** (not canyon-width fractions), a density scalar (fed in from `TrackBiomes.ts` `vegetationDensity` / `rockDensity`; the module never imports biome tables), scale and yaw ranges, and an embed depth **along the local normal**.
3. Seed: `forkSeed(fnv1a32(mapId), \`placement:${segmentId}\`)`, with room for a daily-seed fork later. **Behaviour change:** every map's props move. They move anyway (that is the point of the issue); see open question 5.
4. **Deterministic prefix order.** Instances are emitted so that any count cap (LOD, quality, density) is a strict prefix slice of the full list; a cap never changes the RNG sequence. (No decoration cap was found under `src/systems/lod`; if one exists in a biome config, this rule covers it.)
5. `snapOverride(tile, frame, override)`: height and normal from the tile, `localX` / `localZ` untouched, honouring `snap?: boolean` (default `true`). The launch-shelf trigger (`shelfLaunch.ts:103-139`) derives from `localX` / `localZ` and the path and is **not affected by snapping**; the slab's *collider* height is. The seg-14 slab in `meander_to_waterfall.json` ships with `snap: false` in this PR (open question 1).
6. `placementParity.test.ts`: determinism across two runs; worker build == main build byte for byte (Phase D); the surface and band assertions in Acceptance.

### C — Consumers (`src/components/TrackSegment/**`, `Rock.tsx` instancing block only)
1. `usePlacementData.ts` becomes an adapter: it calls `buildSegmentPlacements` (or takes the worker's buffer, Phase D) and materialises the 31 category lists. The **object shape stays for this PR** so the 31 Environment components do not all change at once; the heavy categories (`rocks`, `scatterRocks`, `trees`, `grass`, `canyonGrass`) read the `Float32Array` directly with hoisted scratch `Matrix4` / `Quaternion` / `Vector3`. The 26 light categories (fireflies, bats, birds, fish, mist, …) take their anchor height from the sampler (`waterLevel + 2`, `wallTopY - 1.8` today) and keep their shape.
2. `Rock.tsx`: `computeBoundingSphere()` after the instance matrices are written (and after any count change on slot reuse); the Rapier `rotation` and the `instanceMatrix` are built from the **same quaternion** (Gemini's visual-vs-collider phase risk); instance keys stay `rock-${rockType}-${i}` so Rapier does not churn bodies on a re-render.
3. Schema: `snap?: boolean` on decorations in `level.schema.json:428`; the compiled validators regenerated the way the repo does it (`levelSchemaDebt.ts` if the debt list is still the mechanism); `DecorationPlacement` gains the field.
4. Slot reuse: when a pooled slot goes from a dense to a sparse segment, `instancedMesh.count` and the Rapier instance list change together; a unit test recycles 40 → 10 rocks and asserts no stale instance survives.

### D — Worker ride-along (`src/sim/simWorkerProtocol.ts`, `simWorkerCore.ts`, `useGeometries.ts`; its own last commit)
1. `SegmentMeshSpec` gains `mapId`, the overrides for the segment, and the density scalars the spec needs. `buildTile` (`simWorkerCore.ts:251`) runs `buildSegmentPlacements` on the tile it already built and appends the one `ArrayBuffer` to `segmentMeshTransferables`.
2. `useGeometries.ts` passes `result.placements` through the **existing** `tile.ctx === buildCtx` guard. That guard is the version token gpt-oss asked for: a reply for the previous occupant of a slot already fails the identity check. The parity test exercises it (a delayed reply for segment 7 arriving after slot 7 became segment 17 is dropped).
3. `?simWorker=0` builds the same bytes on the main thread; the parity test compares both paths.
4. Revertable alone: dropping D leaves C building synchronously with identical output.

### E — The hook for #522 C
`sampleBand` and the segment frame are enough for risky-line tags; the tags themselves are #522's.

## Acceptance

- [ ] **Parity:** the placement buffer is byte-identical worker vs main for the five authored maps × first 12 segments **and one late segment per map (index ≥ 20)**, where profiles differ (gpt-oss's coverage point), and for `?simWorker=0` vs default.
- [ ] **Determinism:** same `(mapId, segmentId)` → same bytes across two runs; different `mapId`, same `segmentId` → different bytes (closes the segment-only seed).
- [ ] **Surface:** for every instance with `snap !== false`, `|(p_base − p_tile) · n̂| ≤ 0.15 m` **along the local normal**, not world Y; no `trees` / `rimTrees` in `crown` or inside the fold; the PR carries a per-category table of max deviation over all authored segments.
- [ ] **Prefix property:** a capped layout is a strict prefix of the full layout (unit test).
- [ ] **Ruler:** `test:input-smoke`, `test:input-smoke:gamepad`, `test:replay-smoke` splits and SWE checksums identical to a run on untouched `main`. The SWE bed never reads decorations (nothing under `src/systems/water` or `src/terrain` consumes `PlacementData`), so a checksum change is a bug. A *split* change is allowed only if a collidable rock the scripted run touches moved; the PR names it and re-records with the reason.
- [ ] **Allocation:** `@react-three/no-new-in-loop` / `no-clone-in-loop` 0 hits in the touched files; placement runs at segment build, never in `useFrame`; the worker buffer is transferred, not cloned (assert `byteLength === 0` on the sender in the worker test).
- [ ] **Budget:** measured entry delta in the PR. `usePlacementData` and the `populate*` helpers are in the entry today (the index chunk contains the `rimTrees` key), so the module may *shrink* it; either way stay under `build-budget.json` (737,000 B; under 1 kB of headroom) or raise by the measured amount with the reason in the note.
- [ ] **Visual smoke:** required start-menu shot and native-fetched-once pass; each changed best-effort shot explained (props moving off the water is a visible, expected diff); a note that no prop pops under camera motion after `computeBoundingSphere`.
- [ ] `pnpm typecheck`, `typecheck:test`, `lint --max-warnings 138`, `test`, `test:perf` green.

## Open questions → proposed decisions

1. **Snap authored overrides?** Snap by default, `snap: false` per entry; the seg-14 launch slab is `snap: false` in this PR and revisited once the ruler proves the snapped height harmless. (Gemini and Grok agree; the trigger itself is independent of the visual.)
2. **Worker ride-along now?** Yes, as the last commit. The `tile.ctx` guard already covers the recycle race.
3. **Who owns density?** The spec passed in (`TrackBiomes.ts`); placement owns position, normal and band only.
4. **0.15 m on steep walls?** Right, *along the local normal*. Measured in Y it would reject correct wall props (Gemini's math; gpt-oss had it inverted).
5. **NEW — the seed change moves every map's props.** Accept now, while the visual baselines are being re-explained anyway, or keep `createRng(segmentId)` for this PR and fork by map in a follow-up? Proposal: accept now.
6. **NEW — do the 26 light categories need typed arrays?** Proposal: no; they take the sampler for their anchor height and keep their object shape. Converting them is a separate, mechanical issue if ever.
7. **NEW — `Rock.tsx` is shared with #521 A** (pillar *timing* registers with SimCore). This issue touches only the instancing block; whichever lands second rebases. Flagging so neither session is surprised.

## Out of scope

`BatchedMesh`; raycast snapping; baked placement data; moving all 31 categories to typed arrays; risky-line tags and stones (#522 C); the LOD cap design; the launch-shelf trigger reading the sampler (a later cleanup); cross-browser byte identity.

## Blocked on

Nothing. Files are disjoint from #521 A/B/E (`src/sim/core/**`, `src/config/**`, ChunkManager / MapSystem / biome / journey / weather / sky, Obstacles *timing*, `src/experience/**`, `App.tsx`) except `Rock.tsx`'s instancing block (question 7) and one additive optional field in `MapSystem.types.ts` (#521 B adds `GameplayProfile` there; both additive).

## Reconciled against the tree — what the three reviews got right and wrong

| Claim | Source | Verdict |
|---|---|---|
| Add `sampleTilePlaneAt` / band sampler to `terrainTile.ts`; nothing continuous exists today | Gemini | **Right.** Only `sampleChannelShape` exists. |
| The real placement code is `trackSegmentPropLayouts.ts` | Gemini, issue draft | **Partly.** That file has three helpers; the bulk is `usePlacementData.ts` → `populateZSteps.ts` → `populateSidePart1/2.ts`, 31 categories of THREE objects. |
| `src/types/level.ts`, `src/systems/physics/shelfLaunch.ts`, `InstancedRocks.tsx` | Gemini | **Do not exist.** `MapSystem.types.ts:50`, `src/vehicles/utils/shelfLaunch.ts`, `Rock.tsx` + the Environment components. |
| Keep `placement.ts` under ~2.5 kB for the budget | Gemini | **Made-up number.** The budget is measured; the current code is in the entry, so replacing it may shrink it. |
| Count caps must be a prefix of a canonical list, or quality settings move the props | Gemini | **Right and important.** Adopted as an acceptance test. |
| Visual quaternion vs Rapier Euler can drift; same source for both | Gemini | **Right.** Adopted. |
| One packed `ArrayBuffer`, not many | Gemini | **Right.** Adopted. |
| Seg-14 slab: `snap: false` first | Gemini, Grok | **Adopted**, with the correction that the trigger (`computeShelfTrigger`) is independent of the visual; only the collider height is at stake. |
| `computeBoundingSphere()` after matrix writes is the thing that bites | Grok | **Right.** `Rock.tsx` never calls it. Adopted. |
| `InstancedRigidBodies` is still the right primitive; no newer static-instanced collider in `@react-three/rapier` 2.2 / Rapier 0.19 | Grok | **Accepted** (not independently verified from here). |
| Same-browser main-vs-worker math is byte-identical; cross-browser is not | Grok | **Right**, and the tree already relies on it (`terrainParity.test.ts` after PR #525). |
| Main thread vs worker `Math.sin` differ by ULPs; the worker "may be compiled to WASM with a different rounding mode" | gpt-oss | **Wrong for this repo.** The worker runs the same TS module in the same engine; the SWE solver is the WASM part, not placement. The existing exact mesh parity disproves it. |
| Placement arrays push the 737 kB bundle over | gpt-oss | **Wrong.** Runtime data is not in the JS bundle; only code is. |
| 0.15 m along the normal rejects correct props on steep walls | gpt-oss | **Inverted.** Measuring in Y is what fails on walls; along the normal is the stable metric. |
| A stone slightly below the water changes the SWE checksum | gpt-oss | **Wrong.** The SWE bed is sampled from the tile; decorations never feed it. |
| Late worker reply lands on a recycled slot | gpt-oss | **Real concern, already handled** for meshes by `tile.ctx === buildCtx` in `useGeometries.ts`; placement inherits the guard and the parity test now exercises it. |
| 32-bit hash collisions between (map, segment) pairs | gpt-oss | **Negligible** at a few hundred segments, and a collision only repeats a stream over different geometry. `forkSeed` is what the tree offers; used. |
| Parity only over the first 12 segments misses later profiles | gpt-oss | **Right.** One late segment per map added. |
| Transfer, don't clone; assert the sender is detached | gpt-oss, Grok | **Right.** Adopted. |
| Baked blobs (alt B) are "the only truly deterministic" option | gpt-oss | **Not for the problem at hand.** Same-browser determinism is already in the tree; baking loses the per-day seed. Kept as a derivative. |
| Rapier raycast snapping (alt C) | gpt-oss | **Rejected**: physics is in a worker here, and it adds nondeterminism. |
