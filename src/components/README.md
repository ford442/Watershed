# Components - Coordinate System & Geometry Reference

## Coordinate System
Watershed uses Three.js coordinate system:
- **X-axis**: Left (-) to Right (+)
- **Y-axis**: Down (-) to Up (+)
- **Z-axis**: Forward (+) to Back (-)

## RiverTrack Geometry

### Cross-Section (U-Shape)
The river canyon has a U-shaped profile:
```
        Canyon Rim (Y=15)
        _______________
       |               |
       |               |
       |               |  Canyon Walls
       |               |
       |_______________|
              ^
         Riverbed (Y=0)

     X=-12    X=0    X=12
```

**Dimensions:**
- Width: 24 units (12 units on each side from center)
- Height: 15 units (from Y=0 to Y=15)
- Riverbed width: ~14.4 units (0.6 * 24)

### Path (Spine)
The river follows a CatmullRom curve:
1. **[0, 0, 0]** - Start point
2. **[0, 0, -20]** - Safe zone end (straight, flat)
3. **[10, -5, -70]** - First turn (right and down)
4. **[-20, -20, -120]** - Hard left turn
5. **[0, -40, -180]** - Recenter
6. **[0, -50, -250]** - End

### Safe Starting Zone
- **Z Range**: 30 to -25
- **Characteristics**: Enclosed corridor with gentle drop
- **Purpose**: Place the player inside canyon walls immediately

## Player Spawn Position

### Original Position (FLOATING)
```javascript
position={[0, 18, -10]}
```
- X=0: Center of track ✓
- Y=18: Floating high above canyon ✗ (midair start)
- Z=-10: Within corridor ✓

**Problem**: Starting far above the canyon made the entry feel like a hovering platform.

### Current Position
```javascript
position={[0, -4.5, 5]}
```
- X=0: Center of track ✓
- Y=-4.5: Slightly above creek floor inside walls ✓
- Z=5: Inside enclosed entry corridor ✓

**Solution**: Spawn directly inside the canyon so the player begins grounded in the creek bed.

## Visual Diagram

```
Side View (X=0, looking along Z-axis):

Y=-4.5 →  👤 PLAYER SPAWN (rests inside corridor)
           ║
           ║  Canyon Walls (solid geometry)
           ║
Y=-6   ╚═════╝  Riverbed (collision surface)

```

## Camera Configuration

### Default Camera (App.tsx)
```javascript
camera={{ position: [0, 25, 10], fov: 75 }}
```
- Position: 25 units high, 10 units behind starting point
- FOV: 75 degrees (standard perspective)
- Purpose: Provides initial overview of scene before player control

### Player Camera (Player.jsx)
- Attached to player position + offset
- FPS view (first-person shooter)
- Pointer lock controlled
- Position: `[player.x, player.y + 0.8, player.z]`

## Physics

### Player Collider
- Type: CapsuleCollider
- Dimensions: radius=0.5, height=0.4
- Total height: ~1.4 units
- Collision layers: Default

### Track Collider
- Type: Trimesh (exact geometry match)
- Static rigid body (doesn't move)
- Friction: 1.0 (realistic)

### Gravity
- Default: -9.81 m/s² (realistic Earth gravity)
- Player starts just above the creek floor (Y≈-4.5) and settles onto the riverbed

## Testing Spawn Position

To verify the spawn position is correct:

1. **Visual Test**: Player should appear already inside the corridor (no long fall)
2. **Collision Test**: Player should settle smoothly on the riverbed
3. **Position Test**: Final Y position should be around -5 (standing on surface)
4. **Camera Test**: View should not clip through geometry

## Common Issues

### Player Falls Through Floor
- **Cause**: Collision mesh not loaded/initialized before player spawns
- **Solution**: Ensure Physics component wraps both Track and Player

### Player Stuck in Geometry
- **Cause**: Spawn position intersects with collider
- **Solution**: Increase Y spawn position

### Player Falls Off Track
- **Cause**: X spawn position outside canyon width
- **Solution**: Keep X between -6 and +6 for safe spawning

## Future Improvements

- [ ] Add spawn point component for visual editing
- [ ] Implement respawn system (checkpoints)
- [ ] Add safe spawn validation (check for collisions)
- [ ] Create spawn effect (particle burst, fade-in)
- [ ] Multiple spawn points for track variations
