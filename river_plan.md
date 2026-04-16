# River Plan — Future Expansion Suggestions

## Suggestions for future expansion

### Snow
- Replace rain particles with larger, slower-falling flakes that accumulate on canyon rims and vegetation.
- Reduce water flow speed multiplier and increase surface drag to simulate colder, denser water.
- Tint biome palettes toward desaturated blues and whites; reduce ambient light intensity further.
- Add ice-edge geometry near banks with a refractive/reflective ice shader variant.

### Lightning
- Trigger strobe directional-light flashes during the `storm` weather state with randomized intervals (2–8 s).
- Synchronize audio thunderclaps via the reactive audio system using a delayed `thunder` one-shot after each flash.
- Briefly overexpose the scene (via emissive burst on a fullscreen post-process quad) to simulate lightning illumination across canyon walls.
- Optional: raycast from sky to water to pick a strike point; spawn a small steam/splash VFX burst at the river surface impact.

### Wind-blown leaves
- Add a second instanced particle layer for autumn leaves that drifts with a global wind vector rather than gravity.
- Leaves should tumble (rotational noise) and bank off canyon walls using cheap sphere-collider culling.
- Density and color should tie to the `autumn` biome; increase wind speed during `storm` weather.
- Leaves can briefly obstruct the player’s camera proximity to enhance speed sensation without affecting physics.
