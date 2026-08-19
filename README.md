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
*   **Water Simulation:** Custom GLSL shaders injected via `onBeforeCompile` and `ShaderMaterial` (in `FlowingWater.tsx`, `RiverShader.ts`, and `CanyonMaterial.ts`) drive the live water surface, wetness, moss, and caustics. A separate experimental WebGPU compute path (`HeightmapFlow.ts`) may run on a secondary GPU device when available, but the renderer itself is WebGL2-only. WebGPU/TSL migration is deferred to issue #256 path A.
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

Shipped foundation (do not treat as TODO): map-driven treadmill / `ChunkManager`, water flow forces (`physics/WaterForces` + `WaterForceSystem`), typed `src/` surface, Rapier in-app physics with optional worker proxy paths as already wired.

Open board (unchecked = genuinely open):

- [x] [#369](https://github.com/ford442/Watershed/issues/369) — gpu-chores: blur/hist/reduce helpers (SWE / heightmap flow stays domain)
- [ ] [#370](https://github.com/ford442/Watershed/issues/370) — WebGPU required: hard-fail boot probe (Chrome/Edge)
- [ ] [#372](https://github.com/ford442/Watershed/issues/372) — C++ toolchain honesty (compile_commands, host tests, water-force ABI)
- [ ] [#373](https://github.com/ford442/Watershed/issues/373) — WebGL context contract: apply quality without remounting Rapier
- [ ] [#374](https://github.com/ford442/Watershed/issues/374) — Hydrology as identity (nonlinear SWE, bathymetry, authored river events)
- [ ] [#375](https://github.com/ford442/Watershed/issues/375) — Ghost league Phase C (rival race, checkpoint splits, results screen)

See also [`docs/reference/plan.md`](docs/reference/plan.md) and [`AGENTS.md`](AGENTS.md) for live architecture.

## For AI Agents

This project is designed to be worked on by AI agents. Please adhere to the following:

1.  **Read `AGENTS.md`:** Before making any changes, consult `AGENTS.md` for the project's core vision and technical guidelines.
2.  **Verify Your Work:** After every code change, run the relevant tests and, if possible, visually inspect the changes in the browser.
3.  **Keep it Performant:** Be mindful of the performance implications of your code. Avoid unnecessary re-renders and heavy computations on the main thread.
4.  **Ask for Clarification:** If the task is ambiguous, ask for more details before proceeding.
