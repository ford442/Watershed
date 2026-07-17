# Documentation Index

**Gatekeeper for all Watershed docs.** If a doc is not listed here, it is either archived or not maintained.

---

## Start here (root)

| Doc | Audience | Purpose |
|-----|----------|---------|
| [`README.md`](../../README.md) | Everyone | Project overview and quick start |
| [`CLAUDE.md`](../../CLAUDE.md) | AI assistants | Concise architecture + directory map |
| [`AGENTS.md`](../../AGENTS.md) | Contributors | Full stack reference |
| [`SYSTEMS.md`](../../SYSTEMS.md) | Systems work | Reach / Biome / LOD / Splash contract cards |

---

## Reference (living)

### Run, test, debug

| Doc | When to read |
|-----|----------------|
| [`TESTING.md`](./TESTING.md) | CI, harnesses, known friction log |
| [`QUICK_TROUBLESHOOTING.md`](./QUICK_TROUBLESHOOTING.md) | Something broken right now |
| [`STARTUP_DIAGNOSTICS.md`](./STARTUP_DIAGNOSTICS.md) | Blank scene / shader / load failures |
| [`CODE_HEALTH_GUIDE.md`](./CODE_HEALTH_GUIDE.md) | Shader injection, geometry validation, red flags |

### Rendering & WASM

| Doc | When to read |
|-----|----------------|
| [`RENDERER.md`](./RENDERER.md) | WebGL2 renderer toggle, debug overlays |
| [`RENDERER_CONTRACT.md`](./RENDERER_CONTRACT.md) | WebGPU preference invariant + material guard |
| [`WASM_WATER_FORCES.md`](./WASM_WATER_FORCES.md) | Emscripten build and TS bindings |
| [`ADR_WASM_RAPIER_WATER_FORCES.md`](./ADR_WASM_RAPIER_WATER_FORCES.md) | Rapier ↔ WASM coupling decision |

### Design & maps

| Doc | When to read |
|-----|----------------|
| [`PHYSICS_CONSTANTS.md`](./PHYSICS_CONSTANTS.md) | Tunable physics values |
| [`MAPSYSTEM_STEP5_CONTRACT.md`](./MAPSYSTEM_STEP5_CONTRACT.md) | MapSystem ↔ TrackManager contract |
| [`IMPROVEMENT_PLAN.md`](../archive/IMPROVEMENT_PLAN.md) | Longer-term engineering backlog (aspirational) |
| [`plan.md`](./plan.md) | Biome / feature roadmap |
| [`river_plan.md`](./river_plan.md) | River systems planning notes |
| [`src/LEVEL_DESIGN.md`](../../src/LEVEL_DESIGN.md) | Segment progression and tuning |

### Integration guides

| Doc | Topic |
|-----|-------|
| [`integration_guides/BIOME_INTEGRATION_GUIDE.md`](./integration_guides/BIOME_INTEGRATION_GUIDE.md) | Biome provider wiring |
| [`integration_guides/GAMEHUD_INTEGRATION.md`](./integration_guides/GAMEHUD_INTEGRATION.md) | HUD overlay |
| [`integration_guides/RAFT_INTEGRATION_GUIDE.md`](./integration_guides/RAFT_INTEGRATION_GUIDE.md) | Raft vehicle |
| [`integration_guides/RAFT_AUDIO_INTEGRATION.md`](./integration_guides/RAFT_AUDIO_INTEGRATION.md) | Raft audio |
| [`integration_guides/RAFT_VORTEX_INTEGRATION.md`](./integration_guides/RAFT_VORTEX_INTEGRATION.md) | Vortex mechanic |
| [`integration_guides/SHADER_BROWSER_INTEGRATION.md`](./integration_guides/SHADER_BROWSER_INTEGRATION.md) | Shader browser panel |

---

## Archive (historical)

Point-in-time write-ups. Useful for archaeology; **not** authoritative for current behavior.

| Doc | Snapshot |
|-----|----------|
| [`INVESTIGATION_SUMMARY.md`](../archive/INVESTIGATION_SUMMARY.md) | 2026-02 startup investigation executive summary |
| [`CHANGES_SUMMARY.md`](../archive/CHANGES_SUMMARY.md) | Past change log |
| [`VISUAL_ENHANCEMENT_SUMMARY.md`](../archive/VISUAL_ENHANCEMENT_SUMMARY.md) | Visual pass notes |
| [`LEVEL_AUTHORING_SUMMARY.md`](../archive/LEVEL_AUTHORING_SUMMARY.md) | Early level-authoring summary |
| [`IMPROVEMENT_PLAN.md`](../archive/IMPROVEMENT_PLAN.md) | Engineering backlog draft (aspirational) |
| [`plan-dec-25.md`](../archive/plan-dec-25.md) | December 2025 planning draft |
| [`.swarm-state.md`](../archive/.swarm-state.md) | Agent session state artifact |

---

## Non-docs

| Path | Note |
|------|------|
| [`notes/`](../../notes/) | Scratch prompts and personal scripts — not maintained |

---

**Path validation:** CI runs `node scripts/validate-markdown-paths.js` against `CLAUDE.md`, `SYSTEMS.md`, and `docs/reference/` so broken `src/` links are caught on every PR.
