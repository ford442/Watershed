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
    npm install
    ```
2.  **Start the development server:**
    ```bash
    npm start
    ```

This will open the project in your default browser.

## Technical Architecture

The project uses a hybrid architecture to achieve high performance and realism while maintaining a fast development workflow.

*   **UI and Orchestration:** [React](https://react.dev/) with [React Three Fiber (R3F)](https://docs.pmnd.rs/react-three-fiber/getting-started/introduction) for rendering 3D scenes.
*   **Physics:** [Rapier](https://rapier.rs/) running in a Web Worker, compiled to Wasm for near-native performance. This keeps the main thread free from heavy physics calculations.
*   **Water Simulation:** Custom [WebGPU](https://www.w3.org/TR/webgpu/) compute shaders (WGSL) for realistic water surface deformation, flow, and interaction.
*   **Asset Streaming:** A "treadmill" or chunk-based system loads and unloads parts of the world as the player moves, with object pooling to minimize garbage collection.

## Project Structure

The codebase is organized for scale and maintainability:

### Source Code (`src/`)
*   **`mechanics/`** - Player abilities and controls
    *   `Player.jsx` - First-person player controller with physics
*   **`world/`** - Biome-specific components
    *   `CreekCanyon/` - Creek canyon biome with procedural terrain
*   **`systems/`** - Game loops and managers (future: ChunkSystem, AudioSystem)
*   **`shaders/`** - Centralized shader code (WGSL/GLSL)
    *   `sky.wgsl` - Sky rendering
    *   `terrain.wgsl` - Terrain rendering
    *   `tree.wgsl` - Vegetation rendering
    *   `water.wgsl` - Water simulation
*   **`store/`** - Global state management (Zustand)
    *   `gameStore.ts` - Game state (score, health, speed, chunks)
*   **`__tests__/`** - Smoke tests and unit tests
*   **`Experience.jsx`** - Main 3D scene orchestrator
*   **`App.tsx`** - Root application component

### Assets
*   **`assets/`** - Source assets (high-resolution, uncompressed)
    *   `concepts/` - Concept art and design references
    *   `textures/` - Source texture files
    *   `models/` - Source 3D models (.blend, .fbx)
*   **`public/`** - Production-ready, optimized assets
    *   Compressed textures and models
    *   Audio files
    *   `index.html`

### Documentation
*   **`AGENTS.md`** - Core vision and technical guidelines for AI agents
*   **`ASSET_WORKFLOW.md`** - Asset pipeline and optimization guide
*   **`README.md`** - This file

## State Management

The project uses [Zustand](https://github.com/pmndrs/zustand) for global state management:

```javascript
import { useGameStore } from './store';

function GameComponent() {
  const score = useGameStore((state) => state.score);
  const incrementScore = useGameStore((state) => state.incrementScore);
  
  return <div onClick={() => incrementScore(10)}>Score: {score}</div>;
}
```

**State includes:**
- Game metrics: score, health, game speed
- Chunk data: active chunks, streaming state
- Game state: pause, game over

See `src/store/gameStore.ts` for the complete API.

## Roadmap

The current development priorities are:

- [ ] Prototype a WebGPU compute shader that updates a small heightmap (flowmap + normal reconstruction).
- [ ] Move a minimal Rapier physics example into a Web Worker and verify round-trip state updates.
- [ ] Implement a simple treadmill/chunk streaming prototype and object pooling for static obstacles.
- [ ] Integrate water flow forces to influence a rigid-body raft.

## Testing

Run the smoke test suite to verify core functionality:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage --watchAll=false
```

**Test coverage includes:**
- Component smoke tests (App, Experience)
- State management tests (game store)
- Setup with WebGL and browser API mocks

See `src/__tests__/README.md` for detailed testing guidelines.

## Asset Pipeline

When working with assets, follow the standardized workflow:

1. **Source files** go in `assets/` (concepts, textures, models)
2. **Optimize** for web (compress textures, Draco-compress models)
3. **Production files** go in `public/`

**Recommended formats:**
- Textures: KTX2/Basis Universal (fallback: compressed JPEG)
- Models: Draco-compressed glTF/GLB
- Audio: OGG Vorbis

See **[ASSET_WORKFLOW.md](./ASSET_WORKFLOW.md)** for complete guidelines.

## For AI Agents

This project is designed to be worked on by AI agents. Please adhere to the following:

1.  **Read `AGENTS.md`:** Before making any changes, consult `AGENTS.md` for the project's core vision and technical guidelines.
2.  **Read `ASSET_WORKFLOW.md`:** When working with assets, follow the standardized pipeline.
3.  **Run Tests:** Before and after code changes, run `npm test -- --watchAll=false` to verify nothing breaks.
4.  **Verify Your Work:** After every code change, run the relevant tests and build (`npm run build`).
5.  **Keep it Performant:** Be mindful of the performance implications of your code. Avoid unnecessary re-renders and heavy computations on the main thread.
6.  **Ask for Clarification:** If the task is ambiguous, ask for more details before proceeding.
