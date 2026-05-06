# Watershed — Weekly Plan

## Today's focus
<!-- Routine writes here each run. You can delete after day ends, or keep as history. -->
**2026-04-29 — Step 3: Water Visual Quality**
Tune bank/edge foam density near canyon walls (EDGE_FOAM_WIDTH + foam multiplier in FlowingWater.jsx); wire camera-height turbulence so wave amplitude scales with how close the camera is to the water surface (vCameraProximity is computed but never consumed in the fragment shader — add cameraHeight uniform + scale displacement accordingly).

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [in progress — 2026-04-29] Step 3 — Water quality: tune bankFoamMask threshold near canyon walls; add camera-height turbulence (wave amplitude scales with proximity to water surface)
- [x] Step 5 — Wire MapSystem.ts into TrackManager: replace inline getSegmentConfig with DefaultMapManager from MapSystem.ts; move segment config to JSON; create src/maps/meander_to_waterfall.json as first authored map

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [ ] Step 6 — Author maps as JSON arrays in src/maps/ (Step 5 done; JSONMapManager exists but meander_to_waterfall.json is a stub — needs full waypoint sequence matching progression config, and end-to-end validation that JSONMapManager drives TrackManager correctly)
- [ ] Verify RiverShader.js moss effect receives correct world normals from TrackSegment.jsx terrain mesh (visual check needed post-Step-2 commit)
- [ ] Replace stub MP3s in public/sounds/ with real foley/audio assets (current files are silent 477-byte placeholders generated from a base64 minimal MP3)

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
- [x] 2026-04-29 — Step 2 — Terrain Visual Quality: 3-stop vertex color gradient on canyon walls (waterline charcoal → mid grey-brown → rim tan/cream), triplanar UV smoothstep tuned from (0,8) to (6,14), worldNormal varying + moss band tightened to smoothstep(2,4) with normal-based mask in RiverShader.js — committed 7266e6d
- [x] 2026-04-29 — Step 5 — Wire MapSystem.ts into TrackManager (PR #122): DefaultMapManager drives TrackManager via getChunkConfig(), MEANDER_TO_WATERFALL_PROGRESSION config in meander_to_waterfall.ts, JSON stub in meander_to_waterfall.json
- [x] 2026-04-13 — Fix WebGL shader compilation errors (PR #119): double-texture in RiverShader.js, unconditional vertex attribute declarations, floor material missing enableMoss/enableTriplanar flags
- [x] 2026-04-09 — Harden startup rendering / loading routine (PR #117): shader injection fail-safe, geometry validation, process.env → import.meta.env, Mist/SunShafts hash() fix
- [x] 2026-04-09 — Fix production ReferenceError + validation/test coverage (PR #115)
- [x] 2026-04-02 — Upgrade three to ^0.168.0 to satisfy postprocessing peer dep (PR #114)
- [x] 2026-03-19 — Fix vUv2/uv2 conditional guard in RiverShader (PR #113)
- [x] Step 1 — Strip all debug artifacts (green panel, yellow wireframe, hotpink cube, antialias: true, conditional stars) — confirmed clean in App.tsx, Player.jsx, RaftVehicle.tsx, EnhancedSky.jsx
- [x] Step 4 — Post-processing stack: Bloom, Vignette, ChromaticAberration, SSAO, HueSaturation all wired into Experience.jsx via PostProcessingEffects.jsx

## Last run
<!-- Routine writes summary here each run. Overwrites previous. -->
Date: 2026-04-29
Mode: User Idea — Step 3 (Water Quality) is the only remaining Ideas item; Step 5 completed last week via PR #122.
Focus: Step 3 — Water Visual Quality (bank foam density + camera-height wave turbulence)
Outcome: Dispatch produced. weekly_plan.md updated (Step 2 + Step 5 → Done; Step 6 backlog added).
