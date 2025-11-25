# PROJECT IDENTITY: WATERSHED

## 1. Core Concept & Philosophy
**WATERSHED** is a high-octane, photorealistic downhill action game. It blends the kinetic speed and flow of a linear runner (e.g., *Sonic the Hedgehog*) with the physics and grit of a survival simulation.

**The "Shedding" Philosophy:**
The title "Watershed" has a double meaning for this project:
1.  **Geographical:** We are traversing a massive, interconnected water system from alpine source to valley delta.
2.  **Kinetic:** The player moves with such velocity that they are "shedding" the water as they traverse past it. The goal is flow, speed, and momentum.

## 2. Visual & Aesthetic Guidelines (Alpine Edition)
* **Biome:** High Alpine Tundra / Glacial Polish.
* **Key Reference:** Yosemite High Sierra, Tenaya Canyon.
* **Materials:**
    * **Glacial Polish:** The primary surface is smooth, reflective granite. Use anisotropic roughness maps to simulate the direction of ancient glacial movement.
    * **Meltwater:** Clear, thin films of water rather than murky deep rivers. Caustics are critical here.
* **Lighting:** Harsh, high-altitude sunlight. High contrast.
* **The "Rivulet" Tech:**
    * Instead of a single large water volume, generate a "Flow Map" that dictates where the thin water flows over the rock.
    * **Gameplay Mechanic:** The player travels faster on "wet" pixels (rivulets) and slows down/takes damage on "dry" pixels (raw granite).
    * 
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

