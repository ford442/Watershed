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

The codebase is organized as follows:

*   `public/`: Contains the main `index.html` file and other static assets.
*   `src/`: The heart of the application, containing all React components, game logic, and styles.
*   `assets/`: For storing 3D models, textures, and other game-specific assets.
*   `AGENTS.md`: Provides the core creative and technical vision for AI agents working on this project. All agents should adhere to the guidelines within.

## Level Design

For detailed information on the game's level design, including segment configurations, gameplay mechanics, and performance targets, please see [`src/LEVEL_DESIGN.md`](src/LEVEL_DESIGN.md).

## Roadmap

The current development priorities are:

- [ ] Prototype a WebGPU compute shader that updates a small heightmap (flowmap + normal reconstruction).
- [ ] Move a minimal Rapier physics example into a Web Worker and verify round-trip state updates.
- [ ] Implement a simple treadmill/chunk streaming prototype and object pooling for static obstacles.
- [ ] Integrate water flow forces to influence a rigid-body raft.

## For AI Agents

This project is designed to be worked on by AI agents. Please adhere to the following:

1.  **Read `AGENTS.md`:** Before making any changes, consult `AGENTS.md` for the project's core vision and technical guidelines.
2.  **Verify Your Work:** After every code change, run the relevant tests and, if possible, visually inspect the changes in the browser.
3.  **Keep it Performant:** Be mindful of the performance implications of your code. Avoid unnecessary re-renders and heavy computations on the main thread.
4.  **Ask for Clarification:** If the task is ambiguous, ask for more details before proceeding.
