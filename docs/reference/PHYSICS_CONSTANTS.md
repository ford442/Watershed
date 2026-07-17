# Physics Constants - Scientific Alignment

This document catalogs the scientifically-accurate physics constants used in the Watershed game, as verified through Wolfram Alpha computational data.

## Summary of Changes

The game's physics have been aligned with real-world scientific constants to provide more realistic simulation while maintaining good gameplay feel.

---

## Fundamental Constants

| Constant | Value | Unit | Source | Previous Value |
|----------|-------|------|--------|----------------|
| **Gravity** | 9.8 | m/s² | [Wolfram Alpha](https://www.wolframalpha.com/input?i=acceleration+due+to+gravity+on+Earth) | 20 m/s² (2x too high) |
| **Water Density** | 1000 | kg/m³ | Wolfram Alpha (fresh water) | Not defined |
| **Air Density** | 1.226 | kg/m³ | [Wolfram Alpha](https://www.wolframalpha.com/input?i=density+of+air+at+sea+level) | Not defined |
| **Human Density** | 1038 | kg/m³ | [Wolfram Alpha](https://www.wolframalpha.com/input?i=average+human+body+density) | Not defined |
| **Water Viscosity** | 8.9×10⁻⁴ | Pa·s | [Wolfram Alpha](https://www.wolframalpha.com/input?i=dynamic+viscosity+of+water) | Not defined |
| **Water Surface Tension** | 0.0728 | N/m | [Wolfram Alpha](https://www.wolframalpha.com/input?i=surface+tension+of+water) | Not defined |

---

## Player/Vehicle Mass

Based on human body density of 1038 kg/m³ and typical volumes:

| Entity | Mass | Volume | Density | Notes |
|--------|------|--------|---------|-------|
| **RunnerVehicle** | 75 kg | ~0.072 m³ | ~1038 kg/m³ | Human (70kg) + gear (5kg) |
| **RaftVehicle** | 150 kg | ~1.8 m³ | ~83 kg/m³ | Inflatable raft (floats easily) |
| **Legacy Player** | 75 kg | ~0.072 m³ | ~1038 kg/m³ | Updated for consistency |
| **Legacy Raft** | 150 kg | ~1.8 m³ | ~83 kg/m³ | Updated for consistency |

### Previous Values (Unrealistic)
- Runner: 1 kg (like a bag of sugar!)
- Raft: 5 kg (like a small cat!)

---

## Jump Physics

### Calculations
For a 0.6m jump height at 9.8 m/s² gravity:
```
v = √(2 × g × h) = √(2 × 9.8 × 0.6) ≈ 3.43 m/s
```

### Updated Values
| Jump Type | Old Force | New Force | Calculation |
|-----------|-----------|-----------|-------------|
| Runner Jump | 22 | **45** | 22 × (20/9.8) ≈ 45 |
| Runner Double Jump | 18 | **37** | 18 × (20/9.8) ≈ 37 |
| Legacy Player Jump | 5 | **10** | 5 × (20/9.8) ≈ 10 |

The scaling factor of 20/9.8 ≈ 2.04 maintains equivalent jump heights when gravity is reduced from 20 to 9.8 m/s².

---

## Water & Buoyancy Physics

### Buoyancy Formula
```
F_buoyancy = ρ_water × V_displaced × g
```

For the raft (150kg, 1.8m³ volume):
- Fully submerged buoyancy: 1000 × 1.8 × 9.8 = **17,640 N**
- Gameplay-scaled max force: **2,940 N** (provides ~2x safety margin for stability)

### Key Physics Insight
- **Human buoyancy**: Humans (1038 kg/m³) are slightly denser than water (1000 kg/m³), so we slowly sink
- **Raft buoyancy**: Rafts (~83 kg/m³) are much less dense than water, so they float high

### Drag in Water vs Air
Water drag is approximately **800× higher** than air drag at the same velocity due to density difference:
```
F_drag = 0.5 × ρ × v² × Cd × A

Water:  F_drag = 0.5 × 1000 × v² × Cd × A
Air:    F_drag = 0.5 × 1.226 × v² × Cd × A
Ratio:  1000/1.226 ≈ 816
```

---

## Drag Coefficients

| Entity | Medium | Cd Value | Scientific Basis |
|--------|--------|----------|------------------|
| **Runner (air)** | Air | Documented as 1.0-1.3 | Human standing: Cd ≈ 1.0-1.3, streamlined: Cd ≈ 0.7 |
| **Raft (water)** | Water | **0.9** | Rectangular bluff body: Cd ≈ 0.8-1.2 |

### Linear Damping (Game-Tuned)
Linear damping values in Rapier are kept for gameplay feel rather than strict physics:
- Runner: 0.35 (allows responsive movement)
- Raft: 2.5 (simulates water resistance)

---

## Files Modified

| File | Changes |
|------|---------|
| `src/Experience.tsx` | Gravity: -20 → -9.8 |
| `src/constants/game.ts` | Added scientific constants, updated jump forces |
| `src/systems/VehicleSystem.ts` | Mass: 1→75, 5→150; added physics documentation |
| `src/vehicles/RunnerVehicle.tsx` | Mass: 1→75, Jump: 22→45, DoubleJump: 18→37 |
| `src/vehicles/RaftVehicle.tsx` | Mass: 5→150, updated buoyancy calculations |
| `src/components/Player.tsx` | Mass: 1→75 |
| `src/components/Raft.jsx` | Mass: 5→150 |
| `src/systems/WaterSystem.ts` | Added scientific calculation methods |

---

## Gameplay Impact

### What Changed
1. **More realistic gravity** - Objects fall at Earth-normal rates
2. **Heavier player/raft** - More momentum, realistic collisions
3. **Proper jump heights** - Maintained despite gravity change
4. **Scientific buoyancy** - Raft floats realistically
5. **Higher water drag** - Water feels more "thick"

### What Stayed the Same
- Jump heights (scaled to maintain feel)
- Overall game responsiveness
- Fun factor!

---

## References

All constants verified via Wolfram Alpha:
- Earth Gravity: https://www.wolframalpha.com/input?i=acceleration+due+to+gravity+on+Earth
- Air Density: https://www.wolframalpha.com/input?i=density+of+air+at+sea+level
- Human Density: https://www.wolframalpha.com/input?i=average+human+body+density
- Water Viscosity: https://www.wolframalpha.com/input?i=dynamic+viscosity+of+water
- Water Surface Tension: https://www.wolframalpha.com/input?i=surface+tension+of+water
