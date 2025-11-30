# PROJECT IDENTITY: WATERSHED

## 1. Core Concept & Philosophy
**WATERSHED** is a high-octane, photorealistic downhill action game. It blends the kinetic speed and flow of a linear runner (e.g., *Sonic the Hedgehog*) with the physics and grit of a survival simulation.

**The "Shedding" Philosophy:**
The title "Watershed" has a double meaning for this project:
1.  **Geographical:** We are traversing a massive, interconnected water system from alpine source to valley delta.
2.  **Kinetic:** The player moves with such velocity that they are "shedding" the water as they traverse past it. The goal is flow, speed, and momentum.

## 2. Visual & Aesthetic Guidelines (Creek Canyon Prototype)
* **Biome:** Creek Canyon. Narrow, steep-walled rock flumes with rushing water.
* **Key Reference:** `assets/concepts/01_kinetic_flume.png`
* **Materials:**
    * **Rock:** Mossy, wet, dark stone. Steep canyon walls.
    * **Water:** Rushing white water, churning and energetic. (represented by simple blue plane in early prototypes).
* **Atmosphere:** Enclosed, claustrophobic but energetic. Sunlight filtering down from high above.

## 3. Gameplay Mechanics (The "Flow" State)
The game is linear and downhill. The player is "trapped" by the river banks.

* **Movement:** Sliding down flumes, diving off waterfalls.
* **The Loop:** Maintain momentum. Stopping is failure.
* **Physics:** Rigorous rigid body physics using **Rapier** (Wasm).

## 4. Technical Constraints & Architecture
* **Stack:** Hybrid Architecture.
    * **UI & Logic:** TypeScript / React (React Three Fiber).
    * **Simulation:** WebAssembly (Wasm) & WebGPU.
    * **Physics:** Rapier (via `@react-three/rapier`).
* **Map Generation:**
    * Initial prototype uses a **Static Procedural Segment**.
    * Heightmap-based geometry for the canyon walls and riverbed.
* **Performance:** Code must be optimized for high velocity.

## 5. Tone & Vibe
* **Keywords:** Kinetic, Elemental, Unforgiving.
* **Anti-Patterns:** Do not create "cartoony" or "arcade-style" UI. The UI should be minimal, diegetic, or industrial/clean.
