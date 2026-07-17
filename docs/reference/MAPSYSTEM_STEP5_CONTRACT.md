# MapSystem Contract Update (Step 5)

## What changed

`src/systems/MapSystem.ts` is now the single source of truth for treadmill segment generation. The following helpers were added or promoted to public exports:

- `generateSegmentPath(index, startPoint, startDirection, progression, seed, options?)`
  - Generates 4 Catmull-Rom control points for one segment using the authored `SegmentProgressionConfig` (`meanderStrength`, `verticalBias`, `type`) and `SeededRandom`.
  - Replaces the duplicated path-generation loop that previously lived in `ChunkManager.ts`.

- `calculateSegmentSpawns(curve, progression, index, seed)`
  - Deterministic tree/rock spawn placement driven by authored `decorations` counts or `treeDensity` / `rockDensity`.
  - Shared by `DefaultMapManager`, `JSONMapManager`, and `ChunkManager`.

- `BaseMapChunk.config`
  - New optional passthrough field carrying `decorations` and `launchShelf` from the segment progression to `TrackSegment`.

- `DefaultMapManager.generateChunk(index, previousChunk?)`
  - Now accepts an optional previous chunk for continuity-aware start point / direction.
  - Uses `generateSegmentPath` and `calculateSegmentSpawns` internally.

## Consumer impact

- `TrackManager.tsx` no longer owns path generation, pool management, or level-script logic.
- `ChunkManager.ts` delegates path/spawn generation to `MapSystem.ts` while keeping the 7-active / 10-slot / 150-threshold treadmill orchestration unchanged.
- The authored progression in `src/maps/meander_to_waterfall.ts` had single-segment entries (`13`, `15`) corrected with explicit `indexTo` so they do not swallow later segments under "first match wins" semantics.

## Backward compatibility

All existing `MapSystem.ts` exports (`SeededRandom`, `generateRiverPath`, `calculateSpawns`, `DefaultMapManager`, `JSONMapManager`, `ChunkPool`, `JSON_BIOME_NAME_MAP`) are preserved. `generateRiverPath` retains its original signature and behavior.
