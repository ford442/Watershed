# WATERSHED

**WATERSHED** is a high-octane, photorealistic downhill action game. It blends the kinetic speed and flow of a linear runner (e.g., *Sonic the Hedgehog*) with the physics and grit of a survival simulation.

## Core Philosophy: "Shedding"

The title "Watershed" has a double meaning for this project:
1.  **Geographical:** We are traversing a massive, interconnected water system from alpine source to valley delta.
2.  **Kinetic:** The player moves with such velocity that they are "shedding" the water as they traverse past it. The goal is flow, speed, and momentum.

## Getting Started

To get the project running locally, follow these steps:

1.  **Install dependencies:**
    ```bash
    pnpm install
    ```
    > Use pnpm only — the pinned version lives in `package.json`'s `packageManager` field; do not commit `package-lock.json`.
2.  **Start the development server:**
    ```bash
    npm start
    ```

This will open the project in your default browser.

## Technical Architecture

The project uses a hybrid architecture to achieve high performance and realism while maintaining a fast development workflow.

*   **UI and Orchestration:** [React](https://react.dev/) with [React Three Fiber (R3F)](https://docs.pmnd.rs/react-three-fiber/getting-started/introduction) for rendering 3D scenes.
*   **Physics:** [Rapier](https://rapier.rs/) running in a Web Worker, compiled to Wasm for near-native performance. This keeps the main thread free from heavy physics calculations.
*   **Water simulation:** Nonlinear shallow-water (C++ WASM, ABI 6+) displaces `FlowingWater`; gameplay forces sample the same `(η,u,w)` field. Live materials are GLSL (`ShaderMaterial` / `onBeforeCompile`); `?material=tsl` opts into NodeMaterial hosts under WebGL2. gpu-chores adopt the renderer session `GPUDevice` and never request a second one. `HeightmapFlow.ts` is dormant — not a third live field. SWE stays C++ WASM until [#391](https://github.com/ford442/Watershed/issues/391) Phase D.

## Later picture

Watershed’s unique claim is a **playable drainage basin**, not another canyon runner. Authored maps plus `hydroEvents[]`, the launch-hour forecast, and SWE `(η, u, w, b)` share one field that both the mesh and the hull read. Ghosts carry `launchHour` and an event hash so you race the river, not a tape. Biomes are boundary conditions on that field. Native WebGPU / a WGSL SWE twin is [#391](https://github.com/ford442/Watershed/issues/391) Phase D — not a prerequisite for campaign content. Closed [#374](https://github.com/ford442/Watershed/issues/374) was the hydrology foundation; the later product is #391. See [`docs/reference/plan.md`](docs/reference/plan.md).
*   **Asset Streaming:** A "treadmill" or chunk-based system loads and unloads parts of the world as the player moves, with object pooling to minimize garbage collection.

## Project Structure

The codebase is organized as follows:

*   `public/`: Contains the main `index.html` file and other static assets.
*   `src/`: The heart of the application, containing all React components, game logic, and styles.
*   `assets/`: For storing 3D models, textures, and other game-specific assets.
*   `AGENTS.md`: Provides the core creative and technical vision for AI agents working on this project. All agents should adhere to the guidelines within.

## Level Design

For detailed information on the game's level design, including segment configurations, gameplay mechanics, and performance targets, please see [`src/LEVEL_DESIGN.md`](src/LEVEL_DESIGN.md).

## Roadmap

Shipped foundation (do not treat as TODO): map-driven treadmill / `ChunkManager`, typed `src/` surface, Rapier+WASM worker default-on, WebGL quality contract without remounting Rapier, gpu-chores on the session device, nonlinear SWE (ABI 6, wetting/drying, bed *pointer*), ghost league Phase C (splits / results / rival), TSL opt-in for water/river/canyon.

Previous board (closed — do not pick): [#369](https://github.com/ford442/Watershed/issues/369)–[#375](https://github.com/ford442/Watershed/issues/375). #374 Phase 1 (nonlinear SWE) landed; Phase 2 bed sampling and Phase 3 force coupling continue as #385 / #386 (in-tree). #370 WebGPU-required boot stays closed until leftover GLSL is gone.

Open board (unchecked = genuinely open), **foundation before a sixth biome**:

- [x] [#385](https://github.com/ford442/Watershed/issues/385) — **P0** Hydrology Phase 2: canyon collision mesh → SWE bed `b` (`bathymetrySampler.ts`)
- [x] [#386](https://github.com/ford442/Watershed/issues/386) — **P0** One water field: SWE `(η,u,w)` drives Rapier via `sampleSWEFlow` (TS fallback `(0,-1)*flowSpeed` when SWE is off)
- [x] [#387](https://github.com/ford442/Watershed/issues/387) — **P0** TSL remainder inventoried / hosts migrated; leftover sky/weather/VFX GLSL still blocks a native-WebGPU-required boot
- [ ] [#388](https://github.com/ford442/Watershed/issues/388) — **P0** Hygiene: leftover `systems/*.tsx` hosts, host `-ffp-contract=off`, context `alpha` honesty
- [x] [#389](https://github.com/ford442/Watershed/issues/389) — **P1** Authored `hydroEvents[]` + C++/TS source terms (`applySWEEvent`)
- [x] [#390](https://github.com/ford442/Watershed/issues/390) — **P1** SIMD honesty for nonlinear HLL + WASM particle SoA
- [ ] [#391](https://github.com/ford442/Watershed/issues/391) — **P2** Epic: playable drainage basin — campaign as one basin, ghosts vs the river, user-authored maps, one compute backend (Phase D not started)

See also [`docs/reference/plan.md`](docs/reference/plan.md) and [`AGENTS.md`](AGENTS.md) for live architecture.

## For AI Agents

This project is designed to be worked on by AI agents. Please adhere to the following:

1.  **Read `AGENTS.md`:** Before making any changes, consult `AGENTS.md` for the project's core vision and technical guidelines.
2.  **Verify Your Work:** After every code change, run the relevant tests and, if possible, visually inspect the changes in the browser.
3.  **Keep it Performant:** Be mindful of the performance implications of your code. Avoid unnecessary re-renders and heavy computations on the main thread.
4.  **Ask for Clarification:** If the task is ambiguous, ask for more details before proceeding.
