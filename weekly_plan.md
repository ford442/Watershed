# Watershed — Weekly Plan

## Today's focus
<!-- Routine writes here each run. You can delete after day ends, or keep as history. -->
**2026-04-22 — Step 2: Terrain Visual Quality**
Vertex color variation on canyon walls, triplanar UV break-up, moss/lichen bands at waterline — the highest-impact visual delta left before map authoring.

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [ ] Step 3 — Water quality: tune bankFoamMask threshold near canyon walls; add camera-height turbulence (wave amplitude scales with proximity to water surface)
- [ ] Step 5 — Wire MapSystem.ts into TrackManager: replace inline getSegmentConfig with DefaultMapManager from MapSystem.ts; move segment config to JSON; create src/maps/meander_to_waterfall.json as first authored map

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [ ] Step 2 — Terrain visual quality (vertex color variation on upper canyon walls, triplanar UV to break tiling, moss/lichen vertex color bands at waterline, verify RiverShader world-normal wiring in TrackSegment.jsx)
- [ ] Step 6 — Author maps as JSON arrays in src/maps/ (depends on Step 5)
- [ ] Verify RiverShader.js moss effect receives correct world normals from TrackSegment.jsx terrain mesh

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
- [x] 2026-04-13 — Fix WebGL shader compilation errors (PR #119): double-texture in RiverShader.js, unconditional vertex attribute declarations, floor material missing enableMoss/enableTriplanar flags
- [x] 2026-04-09 — Harden startup rendering / loading routine (PR #117): shader injection fail-safe, geometry validation, process.env → import.meta.env, Mist/SunShafts hash() fix
- [x] 2026-04-09 — Fix production ReferenceError + validation/test coverage (PR #115)
- [x] 2026-04-02 — Upgrade three to ^0.168.0 to satisfy postprocessing peer dep (PR #114)
- [x] 2026-03-19 — Fix vUv2/uv2 conditional guard in RiverShader (PR #113)
- [x] Step 1 — Strip all debug artifacts (green panel, yellow wireframe, hotpink cube, antialias: true, conditional stars) — confirmed clean in App.tsx, Player.jsx, RaftVehicle.tsx, EnhancedSky.jsx
- [x] Step 4 — Post-processing stack: Bloom, Vignette, ChromaticAberration, SSAO, HueSaturation all wired into Experience.jsx via PostProcessingEffects.jsx

## Last run
<!-- Routine writes summary here each run. Overwrites previous. -->
Date: 2026-04-22
Mode: New Idea (weekly_plan.md did not exist; bootstrapped fresh from CLAUDE.md roadmap and repo state)
Focus: Step 2 — Terrain Visual Quality
Outcome: Dispatch produced. No code changes this run.
