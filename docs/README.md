# Documentation

**Start here:** [`reference/DOCUMENTATION_INDEX.md`](./reference/DOCUMENTATION_INDEX.md)

## Architecture truth

When docs disagree, trust **code + these living sources** (in order):

| Source | Role |
|--------|------|
| [`../SYSTEMS.md`](../SYSTEMS.md) | Orchestration contracts, live nesting (`Experience.tsx` → `InnerExperience` → `WaterStack`) |
| [`../CLAUDE.md`](../CLAUDE.md) | Onboarding, directory map, controls, visual targets |
| [`../AGENTS.md`](../AGENTS.md) | Agent-oriented stack, commands, cloud caveats |
| [`reference/`](./reference/) | Living reference (testing, renderer, roadmaps, integration guides) |

[`archive/`](./archive/) is historical only — investigation write-ups, dated plans, change summaries. Do **not** treat archive paths or filenames as current architecture.

**Canonical mount points (do not cite the old stems):**

- Scene providers: `src/Experience.tsx`
- Scene graph: `src/experience/InnerExperience.tsx`
- Water adjuncts: `src/experience/WaterStack.tsx`
- Track treadmill: `src/components/TrackManager.tsx`
- Player: `src/vehicles/RunnerVehicle/` / `RaftVehicle/`
- Post-FX: `src/components/PostProcessingPipeline.jsx`

CI: `node scripts/validate-markdown-paths.js` checks living markdown for broken `src/` / `docs/` paths and bans renamed/deleted dual stems (see the script’s ban list).

## Layout

| Directory | What it is |
|-----------|------------|
| [`reference/`](./reference/) | **Living docs** — architecture, testing, renderer contracts, roadmaps, integration guides. Update these when behavior changes. |
| [`archive/`](./archive/) | **Historical snapshots** — investigation write-ups, dated plans, change summaries. Read for context; do not treat as current truth. |

Root-level [`CLAUDE.md`](../CLAUDE.md), [`AGENTS.md`](../AGENTS.md), and [`SYSTEMS.md`](../SYSTEMS.md) are the primary onboarding entry points for agents and contributors.
