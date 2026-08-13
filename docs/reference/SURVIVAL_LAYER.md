# Survival Layer (Track A)

Living design note for the survival gameplay foundation.

**v2 (this pass)** adds spatial portage/cache waypoints, `slipperiness` → Rapier contact
friction, and raft paddle coupling. The MVP pieces below are unchanged.

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
- **Gameplay:** wetness reduces sprint stamina regen; high wetness slightly muffles SFX (modifier exported, audio wiring deferred to settings #301 multiply).

### Core temperature

```
ambient(biome) + insulation(loadout) - wetnessColdDrag ──lerp──► coreTemp (0–1)
```

- **Cold biomes** (`glacier`, `glacialMelt`): low ambient → core temp drops unless expedition kit.
- **Exposure stress** (0–1): derived from core temp, biome cold bias, and wetness.

## Spatial portage & caches (v2)

A cache slot or portage route is **spatial** when its authored definition carries a
`position` (and optional `radius`, default 6 m). Both forms coexist:

| Form | Interaction | Where |
|------|-------------|-------|
| Spatial | Steer within the waypoint radius (XZ distance; height ignored) | `meander`, `hydro` |
| Segment-scoped | Entering the segment is the whole interaction | `delta` |

`SurvivalMarkers` draws a ground ring plus a beacon per live waypoint and polls the
player at 10 Hz. Interaction is proximity-only — no interact key. The player is moving
at speed; "steer through the marker" is the verb the rest of the game already uses.

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

## Checkpoint graph (meander)

Authored in `survivalMetadata.ts` (mirrors `meander_to_waterfall.json` spawns):

| Segment | Label | Respawn window |
|---------|-------|----------------|
| 13 | Approach shelf | Segments 13–14 |
| 15 | Splash pool | Segment 15+ |

On `segment-enter`, `useExperienceLifecycle` calls:

```ts
resolveRespawnSegment(checkpoints, enteredSegment)
```

Returns the **latest** checkpoint segment ≤ entered segment; falls back to entered segment when none apply.

## Pre-run loadout

StartMenu → `LoadoutPicker` → `initRunSession({ loadoutId })`.

HUD shows `LOADOUT <shortLabel>` (top-left) plus WET / EXPOSURE bars (bottom-left stack, imperative DOM).

## Testing

- `survivalState.test.ts` — wetness dry cycle, cold biome, modifier bounds.
- `checkpointTable.test.ts` — meander checkpoint graph.
- `portageCache.test.ts` — segment-scoped state machine.
- `portageSpatial.test.ts` — waypoint geometry, spatial cache loop, portage
  requirement, authored map metadata, raft paddle coupling.
- `surfaceFriction.test.ts` — slipperiness → friction mapping.

## Future (post-MVP)

- **Playtest pass on the authored waypoint positions** — they are first-pass values
  aligned with the checkpoint table, not yet validated in-engine.
- FlowForecast mid-run cache restock synergy.
- Speed-based wind audio (plan.md).
- `safeZone` OOB replacement for fixed `y < -80` wipeout (phase D, not started).
- Wetness SFX muffling — `sfxWetnessMultiplier` is computed but not yet wired to the
  audio bus (waiting on issue #301).

## Related

- [`plan.md`](./plan.md) — roadmap / respawn backlog item
- [`PHYSICS_CONSTANTS.md`](./PHYSICS_CONSTANTS.md) — runner tuning
- Issue #301 — audio channel settings (SFX multiply for wetness)
