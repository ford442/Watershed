# Components Directory Plan

## Current Structure

```
components/
├── Player.jsx        # Player rigid body & FPS controls
├── TrackManager.jsx  # Segment orchestration (NEW)
├── TrackSegment.jsx  # Reusable track piece (NEW)
├── RiverTrack.jsx    # Legacy: single extruded track
└── CreekCanyon.jsx   # Legacy: heightmap-based terrain
```

## Active Components

### Player.jsx
First-person player with Rapier physics capsule collider.
- **Status**: Active
- **TODO**: Add momentum mechanics, water interaction

### TrackManager.jsx
Manages track segment lifecycle.
- **Status**: Active, In Development
- **TODO**: Dynamic loading, pooling, player position tracking

### TrackSegment.jsx
Individual track segment with physics and water.
- **Status**: Active
- **TODO**: Accept biome/style props, optimize geometry

## Legacy Components (Deprecated)

### RiverTrack.jsx
Original single-mesh track implementation.
- **Status**: Deprecated - kept for reference
- **Reason**: Replaced by segment-based system

### CreekCanyon.jsx
Heightmap-based terrain experiment.
- **Status**: Deprecated - kept for reference
- **Reason**: Spline-based approach chosen

---

## Planned Components

```
components/
├── player/                   # TODO: Player Module
│   ├── Player.jsx           # Main player component
│   ├── PlayerCamera.jsx     # Camera follow logic
│   └── PlayerEffects.jsx    # Speed lines, motion blur

├── track/                    # TODO: Track Module
│   ├── TrackManager.jsx     # Segment orchestration
│   ├── TrackSegment.jsx     # Individual segment
│   ├── TrackWater.jsx       # Animated water surface
│   └── TrackObstacles.jsx   # Obstacles & hazards

├── environment/              # TODO: Environment Module
│   ├── Canyon.jsx           # Background canyon walls
│   ├── Skybox.jsx           # Dynamic sky
│   └── Fog.jsx              # Atmospheric effects

├── effects/                  # TODO: Effects Module
│   ├── WaterSpray.jsx       # Particle spray
│   ├── SpeedLines.jsx       # Velocity indicator
│   └── ImpactEffect.jsx     # Collision feedback

└── ui/                       # TODO: UI Module
    ├── Speedometer.jsx      # Diegetic speed display
    └── GameOver.jsx         # End state
```

## Component Guidelines

1. **Keep components focused** - One responsibility per component
2. **Use props for configuration** - Biomes, difficulty, etc.
3. **Memoize expensive geometry** - Use `useMemo` for THREE objects
4. **Separate visuals from physics** - Enables optimization
