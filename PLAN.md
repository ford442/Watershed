# WATERSHED Development Plan

## Current Status: Prototype Phase

The project has established a spline-based track system. The immediate focus is on implementing the core gameplay loop.

---

## Phase 1: Core Engine (Current)

### Priority A: Treadmill/Chunking System ✅ In Progress
- [x] Refactor track into reusable `TrackSegment` component
- [x] Create `TrackManager` to orchestrate multiple segments
- [ ] Implement dynamic segment loading based on player position
- [ ] Add segment unloading for segments behind the player
- [ ] Implement object pooling for performance

### Priority B: Physics Optimization
- [ ] Create simplified collision geometry (low-poly walls)
- [ ] Separate visual mesh from physics mesh
- [ ] Profile and optimize Rapier physics performance
- [ ] Consider convex decomposition vs trimesh

### Priority C: Water Flow (WebGPU)
- [ ] Design water flow vertex shader (WGSL)
- [ ] Implement flowmap-based displacement
- [ ] Add normal reconstruction for lighting
- [ ] Apply water forces to player rigid body

---

## Phase 2: Gameplay Systems

### Player Mechanics
- [ ] Implement momentum-based movement
- [ ] Add slide/drift mechanics for turns
- [ ] Create respawn system for out-of-bounds
- [ ] Add velocity-based camera effects

### Track Generation
- [ ] Design procedural spline generation algorithm
- [ ] Create biome-specific track variations
- [ ] Implement difficulty progression system
- [ ] Add obstacle placement system

## Biomes & Journey — Prototype Concepts

Based on the move from a static map to an infinite, procedural system (via `TrackManager` and the `FlowingWater` shader), we can structure the experience as a descending "Journey" from Alpine Source to Valley Delta. Below are four immediate biomes to prototype, with concrete implementation notes tied to the current codebase.

1. The Glacial Melt (The Source)
	 - Vibe: Blinding white/blue, translucent ice, extremely fast, narrow.
	 - Scene: Start in a melting ice cave — walls are semi-transparent blue ice and water is slushy / low friction.
	 - Technical:
		 - Geometry: In `RiverTrack.jsx` or `TrackSegment.jsx` produce inward-curving walls (reduce track width and curve wall vertices inward) to form a tube/tunnel.
		 - Shader: Extend `FlowingWater.jsx` to expose `baseColor` and `roughness` variants; use a white/blue base and higher roughness for slush.
		 - Physics: In `TrackManager.jsx` bias generated segment control points to steeper Y drops (e.g., direction.y < -0.8) to create high acceleration sections.

2. The Lumber Flume (Forest / Industrial)
	 - Vibe: Mossy wood, dappled sunlight, claustrophobic U-shaped flume.
	 - Scene: Wooden aqueducts that can break, launching the player.
	 - Exciting Interaction — The Jump:
		 - Code: Generate a "Gap" segment in `TrackManager.jsx` (break continuity in spline or emit an air segment with no floor physics). Optionally spawn an invisible collider in the air for bounce or let gravity handle the fall.
		 - Props: Add wooden plank meshes and breakable colliders (simple kinematic rigid bodies).

3. The Hydro-Dam (Obstacle Course)
	 - Vibe: Concrete, rusty metal, calm pool then a violent overflow drain.
	 - Scene: A hydro pool with a vortex that sucks the player into an overflow pipe.
	 - Watery Interaction — The Vortex:
		 - Physics: Add a `CylinderCollider` sensor (Rapier) at pool center and apply centripetal impulses to player rigid body when inside.
		 - Shader: Update `FlowingWater.jsx` to accept a `center` uniform and apply a UV swirl around that center for visual feedback.

4. The Slot Canyon (Tech Demo)
	 - Vibe: Red rock, sharp shadows, extreme vertical walls.
	 - Scene: Narrow channel just big enough for the player; tall walls allow for risky wall-riding.
	 - Mechanic — Wall Riding:
		 - Physics/Materials: Increase friction on wall materials in `RiverTrack.jsx` (`friction` param or material-specific damping) so players can ride walls during high-G turns.
		 - Design: Tune spline curvature and wall profiles to create bankable turns.

Summary: New Mechanics to Prototype
- Waterfalls: Segment where a spline goes nearly vertical — create a special segment type and ensure physics/colliders handle vertical drops.
- Obstacles: Place rocks/logs at `t` positions along splines (use `riverPath.getPoint(t)` during segment generation).
- Currents: Invisible trigger volumes that apply `rb.applyImpulse()` or `rb.addForce()` to push or pull players.

These changes leverage the existing spline-based generation and shader systems to tell a coherent environmental story from source to delta. Prioritize small, testable prototypes for each biome and iterate after playtesting.

## Flow Forecast (Environmental Simulation & Risk)

Introduce a `FlowForecast` tool that predicts how the channel will change hour-by-hour based on temperature, snowpack, and upstream dam releases. This is also a gameplay tool: players must scout portage routes and cache gear on high ground before the water rises. The primary tension is environmental change — e.g., returning to find your planned path now a Class V rapid where a bridge stood yesterday.

Implementation notes:
- Inputs: temperature, snowpack index, dam release schedule (prototype with simplified numeric model or CSV schedule).
- Simulation: discrete hourly steps that map inputs to a `flowRate` value which in turn adjusts segment parameters (width, slope), obstacle density, and difficulty rating.
- Track Effects: `TrackManager` flags segments as `Normal | HighFlow | Flooded | WashedOut`. When state changes occur, swap meshes/colliders, spawn rapids, or disable bridges.
- Portage Mechanics: generate `portageRoute` waypoints and `cache` spawn points on high ground; allow player to pre-place caches (items persist) and mark planned routes; failure to portage yields loss/respawn or environmental penalties.
- UI: add a preview tool for the next 24 hours with predicted hazards and alerts; optional player-facing map overlay for portage scouting.
- Data & Authoring: support both procedural forecasts and authored schedules for set-pieces (dam releases, storm windows).

Prototype Todo: Implement a minimal `FlowForecast` simulation, wire forecasted segment state changes into `TrackManager`, and add simple portage route markers and cache placement mechanics.

---

## Phase 3: Polish & Content

### Visual Effects
- [ ] Implement water spray particles
- [ ] Add motion blur for speed sensation
- [ ] Create environmental fog/atmosphere
- [ ] Design lighting for canyon ambiance

### Audio
- [ ] Rushing water ambiance
- [ ] Speed-based wind sounds
- [ ] Collision/impact effects

---

## Technical Debt & Notes

### Known Issues
- Trimesh colliders are expensive for long tracks (solved by chunking)
- Water currently static (needs shader implementation)

### Architecture Decisions
- **Spline-Based Tracks**: Chosen over heightmaps for explicit "beat" design
- **Segment System**: Enables infinite track generation
- **React Three Fiber**: Provides declarative 3D scene management

---

## File Structure Overview

```
src/
├── components/
│   ├── Player.jsx          # Player physics & controls
│   ├── TrackManager.jsx    # Segment orchestration
│   ├── TrackSegment.jsx    # Individual track piece
│   ├── RiverTrack.jsx      # Legacy single-track (deprecated)
│   └── CreekCanyon.jsx     # Legacy heightmap (deprecated)
├── Experience.jsx          # Main scene composition
├── App.tsx                 # Canvas setup
└── index.tsx              # Entry point
```
