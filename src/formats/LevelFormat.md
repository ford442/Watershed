# Watershed Level Format Specification

## Overview

The Watershed Level Format (WLF) is a declarative JSON-based format for authoring custom river canyon maps. It decouples level design from code, enabling non-programmers to create, share, and iterate on game content.

**Version:** 1.0.0  
**File Extension:** `.wlf.json` (convention)

---

## Core Philosophy

- **Declarative**: Describe what you want, not how to build it
- **Human-Readable**: JSON format that's editable in any text editor
- **Modular**: Segments compose into complete experiences
- **Future-Proof**: Extensible schema that won't break with updates

---

## File Structure

```json
{
  "metadata": { ... },      // Level identity and authorship
  "world": { ... },         // Global world configuration
  "segments": [ ... ],      // Track segments (1-50)
  "spawns": { ... },        // Player start and checkpoints
  "decorationPools": { ... } // Optional: Custom decoration overrides
}
```

---

## 1. Metadata Section

```typescript
interface LevelMetadata {
  name: string;                    // Display name (max 50 chars)
  author: string;                  // Creator name
  description?: string;            // Brief description (max 200 chars)
  difficulty: "beginner" | "intermediate" | "expert" | "custom";
  estimatedDuration: number;       // Seconds (for UI display)
  version: string;                 // Format version (e.g., "1.0.0")
  tags?: string[];                 // Optional search tags
}
```

**Example:**
```json
{
  "metadata": {
    "name": "Canyon Explorer - Easy",
    "author": "ford442",
    "description": "A gentle introduction to Watershed with wide banks and calm waters.",
    "difficulty": "beginner",
    "estimatedDuration": 120,
    "version": "1.0.0",
    "tags": ["tutorial", "calm", "summer"]
  }
}
```

---

## 2. World Section

### 2.1 Track Configuration

```typescript
interface TrackConfig {
  waypoints: [number, number, number][];  // Array of [X, Y, Z] coordinates
  segmentLength: number;                   // Base segment length (20-50)
  totalSegments: number;                   // Total segments to generate (1-50)
  width?: number;                          // Canyon width (default: 35)
  wallHeight?: number;                     // Canyon wall height (default: 12)
}
```

**Waypoint Guidelines:**
- Minimum 4 waypoints required
- Points define a CatmullRom curve path
- Y decreases (downhill) for natural flow
- Z decreases (downstream direction)
- Minimum distance between points: 20 units

### 2.2 Biome Configuration

```typescript
interface BiomeConfig {
  baseType: BiomeType;
  sky: SkyConfig;
  fog: FogConfig;
  lighting: LightingConfig;
  water: WaterConfig;
}

type BiomeType = 
  | "creek-summer"    // Lush green, bright, fireflies
  | "creek-autumn"    // Golden tones, falling leaves
  | "alpine-spring"   // Snowmelt, clear water, cold tones
  | "canyon-sunset"   // Warm oranges, long shadows
  | "midnight-mist";  // Dark blue, heavy fog, fireflies

interface SkyConfig {
  color: string;           // Hex color (e.g., "#87CEEB")
  cloudDensity?: number;   // 0.0 - 1.0
  cloudColor?: string;     // Hex color
}

interface FogConfig {
  color: string;           // Hex color
  near: number;            // Fog start distance (10-200)
  far: number;             // Fog end distance (50-500)
  density?: number;        // Alternative to near/far (0.0-0.1)
}

interface LightingConfig {
  sunIntensity: number;    // 0.5 - 2.0
  sunAngle: number;        // Degrees (0-90)
  sunColor?: string;       // Hex color
  ambientIntensity: number; // 0.1 - 1.0
  hemiSkyColor?: string;   // Hex color
  hemiGroundColor?: string; // Hex color
}

interface WaterConfig {
  tint: string;            // Hex color
  flowSpeed: number;       // 0.0 - 3.0
  opacity?: number;        // 0.0 - 1.0 (default: 0.6)
  surfaceRoughness?: number; // 0.0 - 1.0
}
```

**Example:**
```json
{
  "world": {
    "track": {
      "waypoints": [
        [0, 0, 0],
        [0, 0, -30],
        [10, -5, -80],
        [-15, -15, -140],
        [0, -30, -200]
      ],
      "segmentLength": 30,
      "totalSegments": 8,
      "width": 35
    },
    "biome": {
      "baseType": "creek-summer",
      "sky": {
        "color": "#87CEEB",
        "cloudDensity": 0.4
      },
      "fog": {
        "color": "#D4E9F7",
        "near": 50,
        "far": 200
      },
      "lighting": {
        "sunIntensity": 1.4,
        "sunAngle": 45,
        "ambientIntensity": 0.4
      },
      "water": {
        "tint": "#1a6b8a",
        "flowSpeed": 1.0
      }
    }
  }
}
```

---

## 3. Segments Section

Segments define the runtime generation parameters for each track section.

```typescript
interface SegmentConfig {
  index: number;           // 0-based segment index
  name?: string;           // Display name for editor
  type?: SegmentType;      // Segment behavior type
  biomeOverride?: BiomeType; // Optional: override world biome
  
  // Difficulty (0.0 = safe, 1.0 = extreme)
  difficulty: number;      // 0.0 - 1.0
  
  // Track geometry
  width?: number;          // Override canyon width
  lengthMultiplier?: number; // 0.5 - 2.0
  
  // Flow characteristics
  meanderStrength?: number; // 0.0 - 3.0 (curviness)
  verticalBias?: number;    // -3.0 - 0.0 (downhill slope)
  forwardMomentum?: number; // 0.1 - 2.0 (current strength)
  
  // Decorations (counts per segment)
  decorations: DecorationConfig;
  
  // Physics overrides
  physics?: PhysicsConfig;
  
  // Safety bounds
  safeZone?: SafeZoneConfig;
  
  // Special effects
  effects?: EffectsConfig;
}

type SegmentType = 
  | "normal"     // Standard flowing river
  | "waterfall"  // Vertical drop with particles
  | "pond"       // Wide, calm water
  | "splash"     // Transition zone after waterfall
  | "rapids";    // Fast, turbulent water

interface DecorationConfig {
  trees?: number;          // 0 - 50
  grass?: number;          // 0 - 100
  rocks?: number;          // 0 - 30
  wildflowers?: number;    // 0 - 50
  ferns?: number;          // 0 - 40
  mushrooms?: number;      // 0 - 30
  reeds?: number;          // 0 - 40
  driftwood?: number;      // 0 - 30
  pebbles?: number;        // 0 - 60
  pinecones?: number;      // 0 - 40
  
  // Fauna
  fireflies?: number;      // 0 - 20
  birds?: number;          // 0 - 15 (flock count)
  fish?: number;           // 0 - 20
  dragonflies?: number;    // 0 - 15
  
  // Effects
  fallingLeaves?: number;  // 0 - 30
  floatingLeaves?: number; // 0 - 20 (ponds only)
  mist?: number;           // 0 - 15
  waterLilies?: number;    // 0 - 20 (ponds only)
  sunShafts?: number;      // 0 - 10
  rapids?: number;         // 0 - 20
  rockFoam?: number;       // Auto-generated, read-only
}

interface PhysicsConfig {
  gravityMultiplier?: number;     // 0.5 - 2.0
  waterFlowIntensity?: number;    // 0.0 - 3.0
  friction?: number;              // 0.0 - 1.0
  restitution?: number;           // 0.0 - 1.0 (bounciness)
}

interface SafeZoneConfig {
  yMin: number;            // Minimum safe Y position
  yMax: number;            // Maximum safe Y position
  respawnAt?: number;      // Segment index to respawn at
}

interface EffectsConfig {
  particleCount?: number;      // Waterfall particles (0 - 500)
  cameraShake?: number;        // 0.0 - 1.0
  fogDensity?: number;         // 0.0 - 1.0
  transitionDuration?: number; // Biome transition ms
}
```

**Example Segment:**
```json
{
  "index": 0,
  "name": "Safe Starting Zone",
  "type": "normal",
  "difficulty": 0.2,
  "width": 40,
  "meanderStrength": 0.8,
  "verticalBias": -0.3,
  "decorations": {
    "trees": 12,
    "grass": 25,
    "rocks": 5,
    "wildflowers": 15,
    "fireflies": 8,
    "birds": 3
  },
  "physics": {
    "gravityMultiplier": 1.0,
    "waterFlowIntensity": 0.3,
    "friction": 1.0
  },
  "safeZone": {
    "yMin": -10,
    "yMax": 15
  }
}
```

---

## 4. Spawns Section

```typescript
interface SpawnConfig {
  start: SpawnPoint;
  checkpoints?: CheckpointConfig[];
}

interface SpawnPoint {
  position: [number, number, number];  // [X, Y, Z]
  rotation?: [number, number, number]; // [pitch, yaw, roll] in degrees
  velocity?: [number, number, number]; // Initial velocity
}

interface CheckpointConfig {
  segment: number;         // Segment index
  position: [number, number, number];
  radius?: number;         // Trigger radius (default: 5)
}
```

**Example:**
```json
{
  "spawns": {
    "start": {
      "position": [0, -4.5, 5],
      "rotation": [0, 180, 0]
    },
    "checkpoints": [
      { "segment": 3, "position": [0, -6, -90], "radius": 8 },
      { "segment": 6, "position": [-5, -20, -180], "radius": 10 }
    ]
  }
}
```

---

## 5. Complete Example Maps

### 5.1 Beginner: "Gentle Creek"

```json
{
  "metadata": {
    "name": "Gentle Creek",
    "author": "Watershed Team",
    "difficulty": "beginner",
    "estimatedDuration": 90,
    "version": "1.0.0"
  },
  "world": {
    "track": {
      "waypoints": [
        [0, 0, 0],
        [5, -2, -40],
        [-5, -5, -90],
        [0, -8, -150]
      ],
      "segmentLength": 35,
      "totalSegments": 5,
      "width": 45
    },
    "biome": {
      "baseType": "creek-summer",
      "sky": { "color": "#87CEEB", "cloudDensity": 0.3 },
      "fog": { "color": "#D4E9F7", "near": 60, "far": 250 },
      "lighting": { "sunIntensity": 1.4, "sunAngle": 50 },
      "water": { "tint": "#1a7b9c", "flowSpeed": 0.5 }
    }
  },
  "segments": [
    {
      "index": 0,
      "name": "Starting Pool",
      "difficulty": 0.1,
      "meanderStrength": 0.5,
      "verticalBias": -0.2,
      "decorations": { "trees": 8, "grass": 20, "rocks": 3, "fireflies": 5 }
    },
    {
      "index": 1,
      "name": "Easy Meander",
      "difficulty": 0.2,
      "meanderStrength": 1.0,
      "verticalBias": -0.3,
      "decorations": { "trees": 10, "grass": 25, "rocks": 5, "birds": 2 }
    },
    {
      "index": 2,
      "name": "Gentle Bend",
      "difficulty": 0.25,
      "meanderStrength": 1.2,
      "verticalBias": -0.4,
      "decorations": { "trees": 12, "grass": 22, "rocks": 6, "wildflowers": 10 }
    },
    {
      "index": 3,
      "name": "Final Stretch",
      "difficulty": 0.3,
      "meanderStrength": 0.8,
      "verticalBias": -0.5,
      "decorations": { "trees": 10, "grass": 18, "rocks": 4, "fireflies": 8 }
    },
    {
      "index": 4,
      "name": "Delta Pool",
      "type": "pond",
      "difficulty": 0.1,
      "width": 60,
      "decorations": { "trees": 6, "waterLilies": 15, "fish": 8, "birds": 4 }
    }
  ],
  "spawns": {
    "start": { "position": [0, -4, 10], "rotation": [0, 180, 0] },
    "checkpoints": [
      { "segment": 2, "position": [0, -5, -80] }
    ]
  }
}
```

### 5.2 Intermediate: "Autumn Rapids"

```json
{
  "metadata": {
    "name": "Autumn Rapids",
    "author": "Watershed Team",
    "difficulty": "intermediate",
    "estimatedDuration": 180,
    "version": "1.0.0"
  },
  "world": {
    "track": {
      "waypoints": [
        [0, 0, 0],
        [8, -3, -35],
        [-10, -8, -85],
        [15, -15, -140],
        [-8, -25, -200],
        [0, -35, -270]
      ],
      "segmentLength": 32,
      "totalSegments": 8,
      "width": 35
    },
    "biome": {
      "baseType": "creek-autumn",
      "sky": { "color": "#E8C070", "cloudDensity": 0.5 },
      "fog": { "color": "#B89868", "near": 40, "far": 180 },
      "lighting": { "sunIntensity": 1.1, "sunAngle": 35 },
      "water": { "tint": "#2a5a6a", "flowSpeed": 1.2 }
    }
  },
  "segments": [
    {
      "index": 0,
      "name": "Autumn Entry",
      "difficulty": 0.3,
      "meanderStrength": 1.0,
      "decorations": { "trees": 15, "fallingLeaves": 20, "rocks": 8 }
    },
    {
      "index": 1,
      "name": "First Rapids",
      "type": "rapids",
      "difficulty": 0.5,
      "meanderStrength": 1.5,
      "verticalBias": -0.6,
      "physics": { "waterFlowIntensity": 1.5 },
      "decorations": { "trees": 10, "rapids": 15, "rocks": 12, "ferns": 15 }
    },
    {
      "index": 2,
      "name": "Calm Before Storm",
      "difficulty": 0.4,
      "meanderStrength": 0.8,
      "decorations": { "trees": 18, "mushrooms": 12, "ferns": 20 }
    },
    {
      "index": 3,
      "name": "Twisting Gorge",
      "difficulty": 0.6,
      "meanderStrength": 2.0,
      "verticalBias": -0.8,
      "decorations": { "trees": 12, "rocks": 15, "fallingLeaves": 25 }
    },
    {
      "index": 4,
      "name": "Waterfall Approach",
      "difficulty": 0.7,
      "meanderStrength": 0.3,
      "verticalBias": -1.2,
      "decorations": { "trees": 8, "rocks": 10, "mist": 10 }
    },
    {
      "index": 5,
      "name": "The Drop",
      "type": "waterfall",
      "difficulty": 0.8,
      "verticalBias": -3.0,
      "forwardMomentum": 0.15,
      "physics": { "gravityMultiplier": 1.2 },
      "effects": { "particleCount": 400, "cameraShake": 0.5 },
      "decorations": { "rocks": 5, "mist": 8 }
    },
    {
      "index": 6,
      "name": "Splash Pool",
      "type": "splash",
      "difficulty": 0.4,
      "width": 70,
      "decorations": { "trees": 5, "waterLilies": 12, "fish": 10 }
    },
    {
      "index": 7,
      "name": "Final Run",
      "difficulty": 0.6,
      "meanderStrength": 1.8,
      "decorations": { "trees": 14, "rocks": 10, "fallingLeaves": 15 }
    }
  ],
  "spawns": {
    "start": { "position": [0, -4, 5], "rotation": [0, 180, 0] },
    "checkpoints": [
      { "segment": 3, "position": [0, -10, -120] },
      { "segment": 6, "position": [0, -25, -200] }
    ]
  }
}
```

### 5.3 Expert: "Devil's Gorge"

```json
{
  "metadata": {
    "name": "Devil's Gorge",
    "author": "Watershed Team",
    "difficulty": "expert",
    "estimatedDuration": 300,
    "version": "1.0.0",
    "tags": [ "extreme", "night", "waterfall", "challenge" ]
  },
  "world": {
    "track": {
      "waypoints": [
        [0, 0, 0],
        [12, -5, -30],
        [-15, -12, -70],
        [20, -20, -120],
        [-18, -35, -180],
        [15, -50, -250],
        [0, -70, -330]
      ],
      "segmentLength": 28,
      "totalSegments": 12,
      "width": 28
    },
    "biome": {
      "baseType": "midnight-mist",
      "sky": { "color": "#1a2030", "cloudDensity": 0.8 },
      "fog": { "color": "#2a3040", "near": 20, "far": 120 },
      "lighting": { "sunIntensity": 0.6, "sunAngle": 20 },
      "water": { "tint": "#0a3a4a", "flowSpeed": 2.0 }
    }
  },
  "segments": [
    {
      "index": 0,
      "name": "Dark Entry",
      "difficulty": 0.6,
      "meanderStrength": 1.5,
      "decorations": { "trees": 10, "fireflies": 15, "rocks": 10 }
    },
    {
      "index": 1,
      "name": "First Trial",
      "difficulty": 0.7,
      "meanderStrength": 2.2,
      "verticalBias": -0.8,
      "physics": { "waterFlowIntensity": 1.8 },
      "decorations": { "rocks": 15, "rapids": 18, "mist": 8 }
    },
    {
      "index": 2,
      "name": "Rock Garden",
      "difficulty": 0.8,
      "meanderStrength": 1.8,
      "rockDensity": "high",
      "decorations": { "rocks": 25, "pebbles": 40, "ferns": 10 }
    },
    {
      "index": 3,
      "name": "Tight Squeeze",
      "difficulty": 0.85,
      "width": 22,
      "meanderStrength": 2.5,
      "verticalBias": -1.0,
      "decorations": { "trees": 8, "rocks": 20, "fallingLeaves": 10 }
    },
    {
      "index": 4,
      "name": "Whitewater",
      "type": "rapids",
      "difficulty": 0.9,
      "forwardMomentum": 1.8,
      "physics": { "waterFlowIntensity": 2.5 },
      "decorations": { "rapids": 25, "rocks": 18, "mist": 12 }
    },
    {
      "index": 5,
      "name": "Calm Deception",
      "difficulty": 0.7,
      "meanderStrength": 1.0,
      "decorations": { "trees": 12, "fireflies": 20, "mushrooms": 15 }
    },
    {
      "index": 6,
      "name": "The Crux",
      "difficulty": 0.95,
      "width": 24,
      "meanderStrength": 3.0,
      "verticalBias": -1.5,
      "physics": { "gravityMultiplier": 1.3, "waterFlowIntensity": 2.0 },
      "decorations": { "rocks": 22, "pebbles": 30, "sunShafts": 5 }
    },
    {
      "index": 7,
      "name": "Upper Falls",
      "type": "waterfall",
      "difficulty": 0.9,
      "verticalBias": -2.5,
      "effects": { "particleCount": 500, "cameraShake": 0.6 },
      "decorations": { "rocks": 8, "mist": 15 }
    },
    {
      "index": 8,
      "name": "Middle Chamber",
      "type": "pond",
      "difficulty": 0.6,
      "width": 50,
      "decorations": { "trees": 6, "waterLilies": 8, "fish": 5 }
    },
    {
      "index": 9,
      "name": "Lower Falls",
      "type": "waterfall",
      "difficulty": 0.95,
      "verticalBias": -3.0,
      "effects": { "particleCount": 450, "cameraShake": 0.7 },
      "decorations": { "rocks": 10, "mist": 12 }
    },
    {
      "index": 10,
      "name": "Final Rapids",
      "type": "rapids",
      "difficulty": 0.9,
      "meanderStrength": 2.0,
      "physics": { "waterFlowIntensity": 2.2 },
      "decorations": { "rapids": 20, "rocks": 15, "driftwood": 15 }
    },
    {
      "index": 11,
      "name": "Exit Pool",
      "type": "pond",
      "difficulty": 0.4,
      "width": 60,
      "decorations": { "trees": 10, "fireflies": 25, "grass": 20 }
    }
  ],
  "spawns": {
    "start": { "position": [0, -4, 5], "rotation": [0, 180, 0] },
    "checkpoints": [
      { "segment": 4, "position": [0, -15, -100] },
      { "segment": 7, "position": [0, -35, -200] },
      { "segment": 10, "position": [0, -55, -280] }
    ]
  }
}
```

---

## 6. Validation Rules

### Required Fields
- `metadata.name` (non-empty string)
- `metadata.author` (non-empty string)
- `metadata.difficulty` (enum value)
- `metadata.version` (semver format)
- `world.track.waypoints` (minimum 4 points)
- `world.track.segmentLength` (20-50)
- `world.track.totalSegments` (1-50)
- `world.biome.baseType` (valid biome enum)
- `segments` (array length must match totalSegments)
- `spawns.start.position` (valid 3D coordinate)

### Numeric Ranges

| Field | Min | Max | Default |
|-------|-----|-----|---------|
| difficulty | 0.0 | 1.0 | 0.5 |
| segmentLength | 20 | 50 | 30 |
| totalSegments | 1 | 50 | 5 |
| width | 20 | 80 | 35 |
| wallHeight | 8 | 20 | 12 |
| meanderStrength | 0.0 | 3.0 | 1.2 |
| verticalBias | -3.0 | 0.0 | -0.5 |
| forwardMomentum | 0.1 | 2.0 | 1.0 |
| gravityMultiplier | 0.5 | 2.0 | 1.0 |
| waterFlowIntensity | 0.0 | 3.0 | 1.0 |
| sunIntensity | 0.5 | 2.0 | 1.4 |
| ambientIntensity | 0.1 | 1.0 | 0.4 |
| flowSpeed | 0.0 | 3.0 | 1.0 |

### Decoration Count Limits

| Decoration | Min | Max |
|------------|-----|-----|
| trees | 0 | 50 |
| grass | 0 | 100 |
| rocks | 0 | 30 |
| wildflowers | 0 | 50 |
| ferns | 0 | 40 |
| mushrooms | 0 | 30 |
| reeds | 0 | 40 |
| driftwood | 0 | 30 |
| pebbles | 0 | 60 |
| pinecones | 0 | 40 |
| fireflies | 0 | 20 |
| birds | 0 | 15 |
| fish | 0 | 20 |
| dragonflies | 0 | 15 |
| fallingLeaves | 0 | 30 |
| floatingLeaves | 0 | 20 |
| mist | 0 | 15 |
| waterLilies | 0 | 20 |
| sunShafts | 0 | 10 |
| rapids | 0 | 20 |

### Geometry Validation
- Waypoints must have unique positions (no duplicates)
- Minimum distance between consecutive waypoints: 20 units
- Maximum distance between consecutive waypoints: 150 units
- Y values should generally decrease (downhill flow)
- No self-intersecting curves (validated at load time)

---

## 7. Editor UI Integration

The Level Editor UI provides visual editing capabilities:

### Segment Inspector
- Real-time JSON synchronization
- Visual previews of segment appearance
- Difficulty visualization (green → red gradient)
- Decoration count sliders with live scene updates

### Path Visualizer
- 3D waypoint editing
- Segment boundary visualization
- Curve smoothness indicators
- Elevation profile graph

### Biome Selector
- Thumbnail grid of biome presets
- Live parameter preview on hover
- Custom biome creation

### Error Panel
- Real-time validation feedback
- Field-level error indicators
- "Fix" suggestions for common issues

---

## 8. File Loading

### URL Parameter Loading
```
https://example.com/?level=custom-map.json
https://example.com/?levelUrl=https://example.com/maps/my-map.json
```

### Programmatic Loading
```javascript
import { useLevel } from './hooks/useLevel';

const { loadFromJSON, levelState } = useLevel();
loadFromJSON(myLevelObject);
```

### File Drop Support
Drag and drop `.wlf.json` files onto the game canvas to load them.

---

## 9. Migration Guide

### From Hardcoded (v0.x)

Old way in `TrackManager.jsx`:
```javascript
const getSegmentConfig = (id) => {
  if (id === 14) {
    return {
      type: 'waterfall',
      verticalBias: -3.0,
      particleCount: 400
    };
  }
  // ...
};
```

New way in `my-map.wlf.json`:
```json
{
  "segments": [
    {
      "index": 14,
      "type": "waterfall",
      "verticalBias": -3.0,
      "effects": { "particleCount": 400 }
    }
  ]
}
```

---

## 10. Changelog

### v1.0.0
- Initial format specification
- Support for 5 biome types
- 21 decoration types
- 5 segment types
- URL-based loading
- Editor UI integration

---

## Appendix A: Biome Visual Reference

### creek-summer
- Sky: Bright blue (#87CEEB)
- Ground: Green-brown transition
- Vegetation: Lush green
- Atmosphere: Fireflies, birds, dragonflies

### creek-autumn
- Sky: Muted gold (#E8C070)
- Ground: Golden-brown
- Vegetation: Orange-yellow
- Atmosphere: Falling leaves, mushrooms

### alpine-spring
- Sky: Crisp blue (#B0D4F0)
- Ground: Gray-brown with snow patches
- Vegetation: Sparse evergreens
- Atmosphere: Cold mist, snowmelt

### canyon-sunset
- Sky: Orange-pink (#FF8C60)
- Ground: Red rock
- Vegetation: Desert scrub
- Atmosphere: Long shadows, warm glow

### midnight-mist
- Sky: Deep blue (#1a2030)
- Ground: Dark, wet rock
- Vegetation: Dark silhouettes
- Atmosphere: Heavy fog, fireflies, mystery
