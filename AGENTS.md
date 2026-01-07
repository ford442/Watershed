# AGENTS.md

## Project Context
**Watershed** is a high-fidelity 3D water simulation and exploration experience running in the browser.
* **Core:** React (TypeScript) + Three.js (React Three Fiber).
* **Rendering:** **WebGPU** (Primary) with specific WGSL shaders.
* **Physics/Compute:** Hybrid architecture using **C++ (Emscripten)** and **AssemblyScript**.
* **Build System:** Webpack + Custom Python scripts.

## Key Directives

### 1. Rendering Engine (WebGPU)
* **Shaders:** We use WGSL (`.wgsl`) located in `public/shaders/`.
* **Materials:** Use `MeshStandardMaterial` or custom `WebGPURenderer` compatible nodes.
* **Constraint:** Do not use legacy WebGL techniques (like `gl_FragColor`) in WGSL shaders. Use proper WGSL syntax (`@vertex`, `@fragment`, `var<uniform>`).

### 2. The Hybrid Build Pipeline
This project does NOT use a monolithic build command. You must build the specific subsystem you are modifying.

* **Frontend (React/TS):**
    * *Command:* `npm start` (Dev Server) or `npm run build` (Bundle).
    * *Action:* Handles UI, Three.js scene graph, and game logic.

* **Native Modules (C++ & AssemblyScript):**
    * *Command:* `python3 build_and_patch.py`
    * *Action:* Compiles C++ (`emscripten/`) and AssemblyScript (`assembly/`), then patches the glue code into the `src/` or `public/` directories.
    * **Rule:** If you modify `.cpp` or `.ts` (in assembly/), you **MUST** run this script. Webpack will not pick up changes until you do.

### 3. Verification & Testing
* **Visual Regression:** We use Python + Selenium to verify graphical fidelity.
    * *Command:* `python3 verify_visuals.py`
    * *Output:* Generates `verification/visuals.png`. Compare this against `verification/initial_state.png`.
* **Deployment:**
    * *Command:* `python3 deploy.py`
    * *Constraint:* Only run after a successful build and visual verification.

## Directory Structure
* **`/src`**: React application source.
    * **`components/`**: 3D objects (Rocks, Trees, Water).
    * **`systems/`**: Game loops and state management.
* **`/public`**: Static assets.
    * **`shaders/`**: WGSL shader source files.
* **`/emscripten`**: C++ source code for heavy compute tasks.
* **`/assembly`**: AssemblyScript source for lighter compiled logic.
* **`/verification`**: Reference images and test scripts.

## Common Pitfalls
1.  **"Shader errors on load":** You likely wrote GLSL syntax in a `.wgsl` file. WebGPU is strict.
2.  **"My C++ changes aren't working":** You forgot to run `python3 build_and_patch.py`.
3.  **"Module not found (WASM)":** The `build_and_patch.py` script ensures the `.wasm` files are moved to the correct public path. Run it to fix missing assets.
