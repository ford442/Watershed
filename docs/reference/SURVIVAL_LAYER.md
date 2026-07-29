# Survival Layer (Track A)

Living design note for the survival gameplay foundation. Track B (WebGPU / TSL) is intentionally deferred until this MVP is stable.

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

### Gameplay modifiers (runner)

Applied in `RunnerPhysicsStep.ts` via `tickRunSurvival()`:

| Modifier | Cold biome effect | Wetness effect |
|----------|-------------------|----------------|
| Stamina drain | +up to 45% at max stress | — |
| Stamina regen | −up to 35% at max stress | −25% at full wet |
| Movement speed | −up to 8% at max stress | — |
| Loadout | insulation + mass | regen/drain baselines |

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

- `src/systems/__tests__/survivalState.test.ts` — wetness dry cycle, cold biome, modifier bounds.
- `src/systems/__tests__/checkpointTable.test.ts` — meander checkpoint graph.

## Future (post-MVP)

- Raft wetness / paddle stamina coupling.
- FlowForecast mid-run cache restock synergy.
- Speed-based wind audio (plan.md).
- `safeZone` OOB replacement for fixed `y < -80` wipeout.
- Track B: NodeMaterial water/canyon under WebGL before WebGPU toggle.

## Related

- [`plan.md`](./plan.md) — roadmap / respawn backlog item
- [`PHYSICS_CONSTANTS.md`](./PHYSICS_CONSTANTS.md) — runner tuning
- Issue #301 — audio channel settings (SFX multiply for wetness)
