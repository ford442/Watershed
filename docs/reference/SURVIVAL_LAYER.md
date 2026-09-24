# Survival Layer (Track A)

Living design note for the survival gameplay foundation.

**v2** added spatial portage/cache waypoints, `slipperiness` → Rapier contact
friction, and raft paddle coupling. **v3 (campaign pass)** authors survival on
every map, anchors waypoints to the live segment, ships segment-relative
`safeZone` envelopes on the set-pieces, and moves `segment-enter` to the moment
the player actually arrives.

## Goals

- **Wetness** (0–1): water and spray in; sun and wind out.
- **Temperature / exposure**: biome ambient cold/heat plus loadout insulation.
- **Gear loadout**: pre-run selection on StartMenu (mass vs insulation).
- **Checkpoints**: authored per map; latest checkpoint at or behind the player anchors respawn.

State lives in **pure TS modules** (`src/systems/survival/`) and **runSession** — not per-frame Zustand writes.

## Module map

| Module | Role |
|--------|------|
| `survival/loadout.ts` | `trail-light` / `balanced` / `expedition` presets |
| `survival/survivalState.ts` | Wetness + core temp tick + gameplay modifiers |
| `survival/checkpointTable.ts` | `resolveRespawnSegment()` pure resolver |
| `maps/survivalMetadata.ts` | Per-map checkpoints, caches, portage routes |
| `map/segmentFrames.ts` | Live segment geometry: `safeZone` envelopes + waypoint anchors |
| `portageCache.ts` | Cache/portage state machine + waypoint geometry |
| `surfaceFriction.ts` | `slipperiness` → Rapier contact friction |
| `components/Survival/SurvivalMarkers.tsx` | World markers + proximity interaction |
| `runSession.ts` | Run-scoped survival instance + `tickRunSurvival()` |

## State transitions

### Wetness

```
DRY ──(in water)──► WET ──(sun + wind dry)──► DRY
         │                                      ▲
         └── spray near surface ────────────────┘
```

Rates (see `survivalState.ts`):

- **Gain in water:** `WETNESS_GAIN_IN_WATER` per second while `pos.y < WATER_LEVEL + 0.55`.
- **Dry:** base rate × sun factor (launch hour) × wind (horizontal speed).
- **Gameplay:** wetness reduces sprint stamina regen; high wetness muffles SFX.
  `tickRunSurvival` pushes `sfxWetnessMultiplier` onto
  [`systems/audio/wetnessMuffle.ts`](../../src/systems/audio/wetnessMuffle.ts), which
  AudioManager reads as a gain (`getEffectiveSfxGain`) and a lowpass on the one-shot
  filter chain. Dry is always the fallback — a run with no survival tick is never ducked.

### Core temperature

```
ambient(biome) + insulation(loadout) - wetnessColdDrag ──lerp──► coreTemp (0–1)
```

- **Cold biomes** (`glacier`, `glacialMelt`): low ambient → core temp drops unless expedition kit.
- **Exposure stress** (0–1): derived from core temp, biome cold bias, and wetness.

## Spatial portage & caches

A cache slot or portage route is **spatial** when it carries an `anchor`
(`{ t, lateral, rise? }` — path parameter, metres right of downstream, negative =
left bank) or a legacy absolute `position`. Anchors resolve against the live
segment (`segmentFrames.resolveSegmentAnchor`), so they follow `?seed=` and sit on
the bank of the track the player is actually on. The first-pass absolute
positions did not: the treadmill descends and meanders hundreds of metres from
any fixed coordinate, so they were nowhere near the river.

| Form | Interaction | Where |
|------|-------------|-------|
| Spatial (anchored) | Steer within the waypoint radius (XZ distance; height ignored) | `glacial`, `lumber`, `meander`, `hydro` |
| Segment-scoped | Entering the segment is the whole interaction | `delta` |

`SurvivalMarkers` draws a ground ring plus a beacon per waypoint whose segment is
on the treadmill and polls the player at 10 Hz. Interaction is proximity-only —
no interact key — and fires on **entering** the radius: previously a cache was
stashed and retrieved on consecutive ticks of the same pass.

Authored waypoints (laterals clear `waterWidth / 2`, stay inside `width / 2`;
`segmentFrames.maps.test.ts` checks both against the map config):

| Map | Cache | Portage |
|-----|-------|---------|
| glacial | seg 10 melt-out shelf at the tube apex | seg 12 snow bridge around the crevasse |
| lumber | seg 7 timber shelf on the flume bend | seg 10 bank line past the washed-out trestle |
| meander | seg 10 rim shelf above the trestle | seg 11 high line past the trestle |
| hydro | seg 9 catwalk above the outfall | seg 13 ledge above the catwalk gate |
| delta | seg 8 sandbar (segment-scoped) | seg 11 side washout (segment-scoped) |

### Cache loop

```
unplaced ──(enter radius)──► placed ──(enter radius again, later)──► retrieved
                               │
                               └──(wipeout on that segment)──► lost
```

- **Stashing** costs the placement slot (`maxCachePlacements`, default 1).
- **Retrieving** awards `retrievalBonus` *and* survival relief — the only mid-run way
  to undo wetness:

| Effect | Amount | Constant |
|--------|--------|----------|
| Wetness removed | −0.45 | `CACHE_WETNESS_RECOVERY` |
| Core temp restored | +0.25 | `CACHE_WARMTH_RECOVERY` |

That is the decision the system exists for: spend a scoring slot early for insurance
against a cold reach later, or bank the bonus and run dry.

### Portage requirement

A route becomes `required` → `in_progress` when its segment enters an elevated
forecast state (`HighFlow` / `Flooded` / `WashedOut`, via `requiresPortageForSegment`).

**A spatial route completes only by reaching its waypoint.** Surviving the flooded
line instead of walking around it is a `failed` route and a `PORTAGE FAILED` penalty
(`PORTAGE_FAIL_PENALTY`, 200) — that's what prices the choice. Segment-scoped routes
keep the legacy rule (survive the segment = pass).

Failure is sticky: a wipeout mid-portage fails the route and reaching the waypoint
afterwards does not resurrect it.

## Surface friction (v2)

`slipperiness` (0–1) now drives **Rapier contact friction** on the canyon collision
mesh, not just water drag. Ownership, which must not be double-counted:

| System | Owns | Reads slipperiness? |
|--------|------|---------------------|
| `surfaceFriction.ts` → `TrackSegmentMeshes` | Solid contact (feet on floor, hull on wall) | Yes |
| `WaterFlowForces` | Water-borne lateral drag + downstream slide bias | Yes |

They act on disjoint interactions (contact vs fluid), so both may read the same value.
What must not happen is a second contact-friction scaler elsewhere, or a fluid-drag
term inside `surfaceFriction.ts`.

Mapping: the flood state sets the baseline (`WashedOut` 0.35, `Flooded` 0.55,
`HighFlow` 0.8, else `biomeProfile.wallFriction`), then slipperiness interpolates that
toward `ICE_MIN_FRICTION` (0.04 — never 0, which makes Rapier jitter). Slipperiness is
monotonic downward: it can only ever make a surface slicker.

## Gameplay modifiers (runner)

Applied in `RunnerPhysicsStep.ts` via `tickRunSurvival()`:

| Modifier | Cold biome effect | Wetness effect |
|----------|-------------------|----------------|
| Stamina drain | +up to 45% at max stress | — |
| Stamina regen | −up to 35% at max stress | −25% at full wet |
| Movement speed | −up to 8% at max stress | — |
| Loadout | insulation + mass | regen/drain baselines |

## Gameplay modifiers (raft) — v2

The raft has no sprint, so wetness and exposure land on the paddle economy instead.
`raftPhysicsRuntime` ticks survival each frame (`inWater` = the raft is actually
floating) and applies:

| Modifier | Effect | Bound at worst case |
|----------|--------|---------------------|
| `paddleCostMultiplier` | Each stroke costs more stamina | < 2× |
| `paddleRegenMultiplier` | Stamina refills slower | ≥ 0 |

Curves are deliberately gentler than the runner's sprint penalties: the raft cannot
choose to stop paddling mid-rapid, so a harsh curve reads as unfair rather than tense.
The HUD WET / EXPOSURE bars are already vehicle-agnostic and show in raft mode.

## Checkpoints

Authored in `survivalMetadata.ts`; the segments twin each map JSON's
`spawns.checkpoints` (tested). Respawn lands on the checkpoint segment's spawn
point — the start of its centreline — so the metadata carries no position (the
JSON positions are informational).

| Map | Checkpoint segments |
|-----|---------------------|
| glacial | 3 tube entry · 10 tube apex · 13 crevasse pool |
| lumber | 5 flume straight · 10 gap lip · 11 landing pool |
| meander | 13 approach shelf · 15 splash pool |
| hydro | 4 stilling basin · 8 outfall splash |
| delta | 2 · 6 · 14 · 21 |

On `segment-enter`, `useExperienceLifecycle` calls:

```ts
resolveRespawnSegment(checkpoints, enteredSegment)
```

Returns the **latest** checkpoint segment ≤ entered segment; falls back to entered segment when none apply.

`segment-enter` fires when the camera crosses into the segment's z span
(`ChunkManager.update`). It used to fire on *generation*, ~150 m (3–4 segments)
ahead of the player, so checkpoints, portage exits (a spatial portage failed
before the player could reach it), gravity and flow all switched early.
Journey completion stays on generation (`onSegmentGenerated`) so the seamless
map handoff attaches before the treadmill builds past the final segment.

## Out of bounds (`safeZone`)

Every map descends: the centreline is below y = −80 within a few segments
(meander's waterfall is ~900 m down at the default seed). The old absolute
`y < -80` clip — in the lifecycle wipeout, the runner sanity hold and the
TrackManager generation gate — therefore fired mid-run on every map and parked
the runner at the world-origin spawn.

Bounds are now **segment-relative** (`segmentFrames.resolveSegmentEnvelope`),
resolved against the segment the player is actually over (by z):

- Authored `safeZone: { yMin, yMax, respawnAt }` — `yMin` metres below the
  segment's lowest centreline point, `yMax` above its highest (or its upstream
  neighbour's, so a runner launched off a lip isn't clipped mid-air).
- No `safeZone` — the global `POSITION_SANE` margins (−80 / +250), anchored the
  same way. They are absolute only before the first segment is published.

An OOB goes through `triggerOutOfBoundsWipeout` (runner physics step or
lifecycle, whichever sees it first): `respawnAt` overrides the checkpoint
table's respawn segment, and the runner is parked on that spawn point rather
than the world origin.

Authored set-pieces (`respawnAt` is a checkpoint at or upstream, or the segment itself):

| Map | Segments | `yMin` | `respawnAt` |
|-----|----------|--------|-------------|
| glacial | 3–9 ice tube | −12 | 3 |
| glacial | 10–11 tube apex / crevasse approach | −12 | 10 |
| glacial | 12 crevasse jump | −20 | 10 (past the apex cache) |
| glacial | 13 crevasse pool | −10 | 13 |
| lumber | 10 open-floor trestle gap | −15 | 10 |
| lumber | 11 landing pool | −10 | 11 |
| meander | 14 waterfall | −20 | 13 |
| meander | 15 splash pool | −12 | 15 |
| hydro | 4 stilling basin, 5 vortex chamber | −8 | 4 |
| hydro | 6 drain throat | −12 | 4 |
| hydro | 7 overflow pipe (waterfall + open floor) | −20 | 7 |
| hydro | 8 outfall splash | −12 | 8 |
| delta | 20 beach approach, 21 beach landing | −12 / −10 | 20 / 21 |

`yMax` is +150 on the set-pieces and +20 on delta's beach (the raft never
nears it; +8 sat under the headroom rule below). The level and reach
validators reject a positive `yMin`, a negative `yMax`, and a `respawnAt`
that is not an integer, names no segment in the map, or is downstream of the
segment it guards — any of those used to fall back to the world-origin spawn.

`src/maps/safeZones.test.ts` is the stale-bounds guard: it walks every
registry map through `ChunkManager` with the runtime forecast at 06:00 and
14:00 and checks each authored zone against the generated centreline — the
hour does not move the path, `yMin` is at least 8 m under the lowest point
(15 m on waterfall / open-floor segments), `yMax` at least 20 m over the
highest, and the `respawnAt` spawn point sits inside its own segment's
bounds. Editing `verticalBias` / `type` on a set-piece without revisiting
its zone fails there.

## Pre-run loadout

StartMenu → `LoadoutPicker` → `initRunSession({ loadoutId })`.

HUD shows `LOADOUT <shortLabel>` (top-left) plus WET / EXPOSURE bars (bottom-left stack, imperative DOM).

## Testing

- `survivalState.test.ts` — wetness dry cycle, cold biome, modifier bounds.
- `checkpointTable.test.ts` — meander checkpoint graph.
- `portageCache.test.ts` — segment-scoped state machine.
- `portageSpatial.test.ts` — waypoint geometry, spatial cache loop, portage
  requirement, anchored waypoint resolution, authored map metadata (glacial /
  lumber coverage, checkpoint ↔ JSON twins, `respawnAt` on a checkpoint), glacial
  loadout core temp, raft paddle coupling.
- `segmentFrames.test.ts` — envelope / anchor math and the frame registry.
- `segmentFrames.maps.test.ts` — every shipped map walked through `ChunkManager`
  at two seeds: no false OOB on the centreline, each set-piece `safeZone` respawns
  on a generated checkpoint, anchors sit on the bank, entry follows the camera.
- `safeZones.test.ts` — every authored zone vs the generated path at 06:00 and
  14:00: floor margin, headroom, respawn point in bounds.
- `runnerAirControl.test.ts` — OOB wipeout → `respawnAt`, not the world origin.
- `surfaceFriction.test.ts` — slipperiness → friction mapping.

## Future

- **GPU playtest of the anchors and `yMin` margins.** Positions are now on the
  track by construction (and tested against the generated geometry), but the
  exact `t` / `lateral` / `yMin` values have not been felt in-engine.
- FlowForecast mid-run cache restock synergy.
- Raft-specific envelope (the raft uses the same lifecycle check, with the
  runner's `POSITION_SANE` margins).

## Related

- [`plan.md`](./plan.md) — roadmap / respawn backlog item
- [`PHYSICS_CONSTANTS.md`](./PHYSICS_CONSTANTS.md) — runner tuning
