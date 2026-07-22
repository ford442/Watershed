# AGENTS.md — Watershed Project Guide

**Watershed** is a high-fidelity 3D downhill action game that blends kinetic speed with survival simulation. The player navigates a river canyon from alpine source to valley delta across authored maps and biomes.

Package name: **`watershed`** (`v0.1.0` in `package.json`).

### Core Philosophy: "Shedding"

1. **Geographical:** Traversing an interconnected water system from source to delta
2. **Kinetic:** Moving with such velocity that the player "sheds" water as they pass it

---

## Architecture truth (read first)

| Living source | What it owns |
|---------------|--------------|
| [`docs/README.md`](./docs/README.md) | Doc layout + architecture pointers |
| [`CLAUDE.md`](./CLAUDE.md) | Human/agent onboarding, controls, visual targets |
| [`SYSTEMS.md`](./SYSTEMS.md) | Orchestration contracts (Reach / Biome / LOD / Splash / WASM) |
| [`docs/reference/`](./docs/reference/) | Living reference (testing, renderer, plans) |
| [`docs/archive/`](./docs/archive/) | Historical only — do **not** treat as current truth |

**Canonical entry / scene graph (as of main):**

```
App.tsx
  └─ Experience.tsx          # LODProvider → BiomeProvider → SunPositionProvider
       └─ InnerExperience.tsx
            ├─ EnhancedSky (useBiome())
            ├─ WaterReflectionLayer / WaterPhysicsEffects  # experience/WaterStack.tsx
            │    ├─ WaterForceSystem
            │    └─ SplashSystem
            ├─ VehicleMount → RunnerVehicle | RaftVehicle
            ├─ TrackManager | ReachManager | LevelLoader
            └─ PostProcessingPipeline.jsx
```

Player movement lives in **`src/vehicles/`**, not a top-level `Player` component. Post-processing live path is **`PostProcessingPipeline.jsx`**. Water forces live in **`physics/WaterForces.ts`** + **`WaterForceSystem`** / **`WaterFlowForces.tsx`**.

CI path check: `node scripts/validate-markdown-paths.js` (living markdown only; bans renamed/deleted dual stems — see the script).

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| UI/Framework | React 19 + TypeScript 5.9 | Component architecture, state |
| 3D Rendering | Three.js 0.168 + React Three Fiber 9.4 | Scene graph, rendering |
| Post-processing | `@react-three/postprocessing` + `postprocessing` via `PostProcessingPipeline.jsx` | Bloom, vignette, SSAO, speed FX |
| Physics | Rapier 0.19 (WASM) via `@react-three/rapier` | Rigid bodies, collisions |
| Build | Vite 7.3 | Dev server + production bundle → `build/` |
| Tests | Vitest + Testing Library | Unit / component tests |
| Audio | Three.js `AudioLoader` via `AudioSystem.ts` | Ambient + SFX (not Howler) |
| State | Zustand (`GameState.ts`) | Shared game state |
| Package manager | pnpm (`pnpm-lock.yaml`) | Dependencies |
| Validation | ajv + ajv-formats | Level / reach JSON schemas |

### Key dependencies

```json
{
  "@react-three/fiber": "^9.4.0",
  "@react-three/drei": "^10.7.7",
  "@react-three/rapier": "^2.2.0",
  "@react-three/postprocessing": "^3.0.4",
  "three": "^0.168.0",
  "@dimforge/rapier3d-compat": "0.19.2",
  "zustand": "^5.0.13",
  "ajv": "^8.18.0",
  "postprocessing": "^6.38.3"
}
```

### Configuration

| File | Purpose |
|------|---------|
| `vite.config.ts` | Dev server port 3000, `base: './'`, manual vendor chunks, outDir `build/` |
| `tsconfig.json` / `tsconfig.typecheck.json` | App TS + typed-surface typecheck |
| `package.json` | Scripts: `dev`, `build`, `test`, `typecheck` |

---

## Directory map

Matches `git ls-files src` (star = primary touch points). Full listing: `git ls-files src`.

```
src/
├── App.tsx                      # Canvas, renderer toggle, error boundaries
├── Experience.tsx               # ★ Provider shell (LOD → Biome → SunPosition)
├── index.tsx                    # Rapier pre-init, global handlers
├── style.css
│
├── experience/                  # Scene composition
│   ├── InnerExperience.tsx      # ★ Track, vehicle, post-processing
│   ├── WaterStack.tsx           # ★ Reflection + Splash + WaterForceSystem
│   ├── VehicleMount.tsx
│   ├── SceneLighting.tsx
│   ├── ExperienceUI.tsx
│   └── hooks/
│
├── components/
│   ├── TrackManager.tsx         # ★ Chunk treadmill (MapSystem-driven)
│   ├── TrackSegment/            # ★ Canyon geometry + decorations
│   ├── FlowingWater.jsx         # ★ Water surface GLSL
│   ├── PostProcessingPipeline.jsx
│   ├── EnhancedSky.jsx          # useBiome() sky / fog
│   ├── WaterReflection.jsx
│   ├── WaterFlowForces.tsx      # Segment flow samples → raft impulses
│   ├── Environment/             # 25+ biome decorations
│   ├── Obstacles/ / VFX/ / LevelEditor/
│   └── GameHUD.tsx / UI.tsx / Loader.tsx / …
│
├── vehicles/
│   ├── RunnerVehicle/           # ★ Default first-person runner
│   └── RaftVehicle/             # ★ Raft buoyancy / paddle
│
├── systems/                     # See SYSTEMS.md
│   ├── MapSystem.ts             # ★ JSON maps, chunk config
│   ├── ChunkManager.ts
│   ├── ReachManager.tsx / ReachStreamer.ts / ReachNormalizer.ts
│   ├── BiomeSystem.tsx / LODManager.tsx / GameState.ts
│   ├── SplashSystem.tsx / WaterForceSystem.tsx / AudioSystem.ts
│   └── …
│
├── physics/                     # WaterForces.ts, Rapier worker proxy
├── maps/                        # Authored JSON + registry.ts
├── configs/ / constants/ / hooks/ / materials/ / rendering/
├── utils/                       # RiverShader, validators
└── formats/                     # level / reach schemas
```

Repo also has `public/` (textures, WASM, levels), `emscripten/` (optional native WASM), `docs/`, and build scripts. There is **no** AssemblyScript `assembly/` tree.

---

## Build and development

```bash
pnpm install
pnpm dev          # Vite on :3000 (alias: pnpm start)
pnpm test         # vitest run (one-shot)
pnpm typecheck    # tsc -p tsconfig.typecheck.json --noEmit
pnpm build        # optional emscripten WASM + vite → build/
```

`pnpm build` runs `emscripten/build.sh` first; if Emscripten is missing it prints a skip message and exits 0, then Vite proceeds.

---

## Key architecture notes

### Track treadmill (`TrackManager.tsx`)

- Map-driven via `MapSystem` / `maps/registry.ts` (`?map=` or `ACTIVE_MAP_ID`)
- Pool: ~7 active segments, recycle behind player
- Segments: CatmullRom control points; decorations via `TrackSegment/`

### Vehicles

| Vehicle | Path | Role |
|---------|------|------|
| Runner | `src/vehicles/RunnerVehicle/` | Default on-foot FPS |
| Raft | `src/vehicles/RaftVehicle/` | Buoyancy, paddle, tip |

Orchestration: `VehicleMount` + `VehicleSystem` / input via `usePlayerControls`.

### Coordinates

```
Y (up) — canyon rim ~+15, water ~0.5
Z — downstream (gameplay forward is −Z)
X — left / right
```

Spawn defaults are map-driven; see `MapSystem` / active map registry.

### Audio

`AudioSystem.ts` uses Three.js `AudioLoader` / `AudioBuffer`. Do **not** add Howler.

### Renderer

Default WebGL2 (`?renderer=webgl`). WebGPU preference exists but forces WebGL2 backend while legacy GLSL materials remain. See [`docs/reference/RENDERER.md`](./docs/reference/RENDERER.md).

### Reach API

`ReachStreamer` hits `/api/reaches/...`. There is **no** backend in this repo — 404s fall back to procedural / map mode. Expected in cloud/dev.

---

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Canvas, renderer factory, error boundaries |
| `src/Experience.tsx` | LOD / Biome / SunPosition providers |
| `src/experience/InnerExperience.tsx` | Physics, vehicle, track, post-FX |
| `src/experience/WaterStack.tsx` | Reflection + water force + splash mount points |
| `src/components/TrackManager.tsx` | Segment pool / map treadmill |
| `src/components/TrackSegment/` | Canyon meshes + placement |
| `src/components/FlowingWater.jsx` | Water shader |
| `src/components/PostProcessingPipeline.jsx` | Live post-processing stack |
| `src/vehicles/RunnerVehicle/` / `RaftVehicle/` | Player vehicles |
| `src/systems/MapSystem.ts` | Maps, chunks, spawn |
| `src/systems/BiomeSystem.tsx` | Biome context (`useBiome`) |
| `src/systems/AudioSystem.ts` | Three.js audio |
| `src/physics/WaterForces.ts` | Flow force math |
| `vite.config.ts` | Vite build |

---

## Testing

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:visual-smoke   # headless WebGL gate (preview serving build/)
node scripts/validate-markdown-paths.js
```

Manual smoke: spawn, WASD + pointer lock, track generates (−Z), textures visible, no console errors, no debug wireframes in polished mode.

---

## Cursor Cloud notes

Single-service frontend — only the Vite dev server. Dependencies come from `pnpm install`.

| Task | Command | Notes |
|------|---------|-------|
| Dev server | `pnpm dev` | Port 3000; use tmux/background |
| Tests | `pnpm test` | Vitest one-shot (`vitest run`) |
| Typecheck | `pnpm typecheck` | Typed surface |
| Build | `pnpm build` | Emscripten optional (skip if missing) |
| Visual smoke | `pnpm test:visual-smoke` | Needs preview/dev + Chromium; see `docs/reference/TESTING.md` |
| Docs paths | `node scripts/validate-markdown-paths.js` | Living docs + banned stale stems |

**Do not** stand up a Reach API backend for local play. **Do not** reintroduce deleted dual Player/post-processing stems, legacy RiverTrack/CreekCanyon components, Howler, or `@xenova/transformers`.
