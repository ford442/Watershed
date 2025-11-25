# PROJECT IDENTITY: WATERSHED

## 1. Core Concept & Philosophy
**WATERSHED** is a high-octane, photorealistic downhill action game. It blends the kinetic speed and flow of a linear runner (e.g., *Sonic the Hedgehog*) with the physics and grit of a survival simulation.

**The "Shedding" Philosophy:**
The title "Watershed" has a double meaning for this project:
1.  **Geographical:** We are traversing a massive, interconnected water system from alpine source to valley delta.
2.  **Kinetic:** The player moves with such velocity that they are "shedding" the water as they traverse past it. The goal is flow, speed, and momentum.

## 2. Visual & Aesthetic Guidelines
All generated assets, shaders, and UI elements must adhere to a **"Hyper-Realistic / Wet"** aesthetic.

* **Atmosphere:** Indifferent nature. Beautiful but dangerous. High contrast lighting (blinding sun on wet rocks, deep dark canyons).
* **Materials:** Everything is wet. Heavy use of specular highlights, normal maps for moss/lichen, and darkened textures to simulate saturation.
* **The Water:** Volumetric and violent. It is not a flat plane; it is a physical force with white water, foam, eddies, and transparency.
* **Camera:** Physical lens simulation. Water droplets on the lens, chromatic aberration at high speeds, shake during impacts.

## 3. Gameplay Mechanics (The "Flow" State)
The game is linear and downhill. The player is "trapped" by the river banks.

* **Movement:** Parkour-style scrambling on rocks, physics-based swimming (fighting currents), and vehicle traversal (rafts, logs).
* **The Loop:** Maintain momentum. Stopping is failure.
    * *High Speed:* Sliding down flumes, diving off waterfalls.
    * *Technical:* Balancing on logs, scrambling over boulder fields.
* **Physics:** Rigorous rigid body physics for debris (logs, rocks) and fluid dynamics for player buoyancy.

## 4. Technical Constraints & Architecture
* **Performance:** Code must be optimized for high velocity. Asset streaming and LOD management are critical as the player moves fast.
* **Shaders:** Custom shaders required for water interaction (caustics, foam generation based on velocity, wetness masks on character).
* **Audio:** Procedural audio focus—the roar of the water changes based on proximity and turbulence.

## 5. Tone & Vibe
* **Keywords:** Kinetic, Elemental, Unforgiving.
* **Anti-Patterns:** Do not create "cartoony" or "arcade-style" UI. The UI should be minimal, diegetic, or industrial/clean.
