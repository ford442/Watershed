# Watershed Level Authoring Guide

Welcome to Watershed level authoring! This guide will help you create custom river canyon maps for the game.

## Quick Start

### 1. Choose a Template

Start with one of our example maps:
- `gentle-creek.json` - Beginner-friendly, calm waters
- `autumn-rapids.json` - Intermediate with waterfall
- `devils-gorge.json` - Expert challenge, dark atmosphere

### 2. Edit the JSON

Open the `.json` file in any text editor and modify:
- `metadata.name` - Your level's name
- `metadata.author` - Your name
- `world.track.waypoints` - The path shape
- `segments` - Segment configurations

### 3. Test Your Level

Load your level via URL parameter:
```
https://your-game-url.com/?level=your-level.json
```

Or use the Level Editor (if available) for visual editing.

## File Structure

```json
{
  "metadata": { ... },      // Level identity
  "world": { ... },         // Global settings
  "segments": [ ... ],      // Track segments
  "spawns": { ... }         // Player spawn points
}
```

## Key Concepts

### Waypoints

Waypoints define the river's path using [X, Y, Z] coordinates:
- **X**: Left/Right position
- **Y**: Height (should decrease for downhill flow)
- **Z**: Forward/downstream position (should decrease)

```json
"waypoints": [
  [0, 0, 0],        // Start point
  [10, -5, -50],   // 10 units right, 5 down, 50 forward
  [-5, -10, -100]  // 5 units left, 10 down, 100 forward
]
```

**Tips:**
- Use 4-10 waypoints for best results
- Keep points at least 20 units apart
- Y should generally decrease (downhill)
- Z should always decrease (downstream)

### Segments

Segments are sections of track between waypoints. Each segment can have:
- Different difficulty
- Different decorations
- Special types (waterfall, pond, rapids)
- Physics overrides

```json
{
  "index": 0,
  "name": "Easy Start",
  "type": "normal",
  "difficulty": 0.2,
  "decorations": { "trees": 10, "grass": 20 }
}
```

### Difficulty Scale

| Value | Description | Color |
|-------|-------------|-------|
| 0.0-0.2 | Very Easy | Green |
| 0.2-0.4 | Easy | Light Green |
| 0.4-0.6 | Medium | Yellow |
| 0.6-0.8 | Hard | Orange |
| 0.8-1.0 | Extreme | Red |

### Segment Types

- **`normal`**: Standard flowing river
- **`waterfall`**: Vertical drop with particles
- **`pond`**: Wide, calm water area
- **`splash`**: Pool at waterfall bottom
- **`rapids`**: Fast, turbulent water

### Biomes

- **`creek-summer`**: Lush green, bright, fireflies
- **`creek-autumn`**: Golden tones, falling leaves
- **`alpine-spring`**: Snowmelt, clear water, cold
- **`canyon-sunset`**: Warm oranges, long shadows
- **`midnight-mist`**: Dark, heavy fog, mysterious

## Decorations Reference

### Vegetation
- `trees` (0-50): Trees along banks
- `grass` (0-100): Grass patches
- `rocks` (0-30): Rock formations
- `wildflowers` (0-50): Colorful flowers
- `ferns` (0-40): Forest undergrowth
- `mushrooms` (0-30): Forest floor detail
- `reeds` (0-40): Shoreline cattails
- `driftwood` (0-30): Logs on banks
- `pebbles` (0-60): Shoreline stones
- `pinecones` (0-40): Under trees

### Fauna
- `fireflies` (0-20): Night lighting
- `birds` (0-15): Flocks flying
- `fish` (0-20): Underwater life
- `dragonflies` (0-15): Daytime activity

### Effects
- `fallingLeaves` (0-30): Autumn atmosphere
- `floatingLeaves` (0-20): On pond water
- `mist` (0-15): Atmospheric fog
- `waterLilies` (0-20): Pond surface
- `sunShafts` (0-10): Light rays
- `rapids` (0-20): Whitewater foam

## Physics Parameters

Control gameplay feel with physics overrides:

```json
"physics": {
  "gravityMultiplier": 1.2,      // 0.5-2.0
  "waterFlowIntensity": 1.5,     // 0.0-3.0
  "friction": 0.8,               // 0.0-1.0
  "restitution": 0.1             // 0.0-1.0 (bounciness)
}
```

## Example: Simple Custom Level

```json
{
  "metadata": {
    "name": "My First Canyon",
    "author": "Your Name",
    "difficulty": "beginner",
    "estimatedDuration": 60,
    "version": "1.0.0"
  },
  "world": {
    "track": {
      "waypoints": [
        [0, 0, 0],
        [5, -3, -40],
        [-5, -6, -80]
      ],
      "segmentLength": 30,
      "totalSegments": 3,
      "width": 40
    },
    "biome": {
      "baseType": "creek-summer",
      "sky": { "color": "#87CEEB", "cloudDensity": 0.4 },
      "fog": { "color": "#D4E9F7", "near": 50, "far": 200 },
      "lighting": { "sunIntensity": 1.4, "sunAngle": 45 },
      "water": { "tint": "#1a6b8a", "flowSpeed": 1.0 }
    }
  },
  "segments": [
    {
      "index": 0,
      "name": "Start",
      "difficulty": 0.2,
      "decorations": { "trees": 8, "grass": 15 }
    },
    {
      "index": 1,
      "name": "Middle",
      "difficulty": 0.3,
      "meanderStrength": 1.5,
      "decorations": { "trees": 12, "rocks": 5, "fireflies": 8 }
    },
    {
      "index": 2,
      "name": "End",
      "difficulty": 0.25,
      "type": "pond",
      "decorations": { "trees": 6, "waterLilies": 10, "fish": 5 }
    }
  ],
  "spawns": {
    "start": { "position": [0, -4, 10], "rotation": [0, 180, 0] }
  }
}
```

## Testing & Debugging

### Validate Your JSON

Use an online JSON validator to check syntax before testing.

### Common Issues

1. **"Segment count doesn't match"**: Ensure `segments` array length equals `totalSegments`
2. **"Duplicate segment index"**: Each segment needs a unique `index` (0, 1, 2, ...)
3. **"Invalid waypoint"**: Waypoints must have 3 numbers: [X, Y, Z]
4. **Level doesn't load**: Check browser console for errors

### URL Parameters

- `?level=filename.json` - Load from `public/levels/`
- `?levelUrl=https://...` - Load from custom URL
- `?no-pointer-lock` - Disable pointer lock (for testing)

## Sharing Your Levels

1. Host your `.json` file on any web server
2. Share the URL: `https://game-url.com/?levelUrl=your-file-url`
3. Or submit to the game's level repository

## Advanced Tips

### Creating Waterfalls

```json
{
  "index": 3,
  "type": "waterfall",
  "difficulty": 0.8,
  "verticalBias": -3.0,
  "forwardMomentum": 0.15,
  "effects": {
    "particleCount": 400,
    "cameraShake": 0.5
  }
}
```

### Biome Transitions

Use `biomeOverride` on segments to change biomes mid-level:

```json
{
  "index": 5,
  "biomeOverride": "creek-autumn",
  "transitionDuration": 2000
}
```

### Checkpoint Placement

```json
"checkpoints": [
  { "segment": 3, "position": [0, -10, -120], "radius": 10 },
  { "segment": 6, "position": [-5, -25, -200], "radius": 12 }
]
```

## Resources

- **Full Schema**: See `level.schema.json` for complete validation rules
- **Format Spec**: See `LevelFormat.md` for detailed documentation
- **Example Maps**: Check `public/levels/` for working examples

## Need Help?

- Check the browser console for error messages
- Validate your JSON syntax
- Start from a working template and modify gradually
- Test frequently as you make changes

Happy mapping! 🌊
