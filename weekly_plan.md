# Watershed — Weekly Plan

## Today's focus
<!-- Routine writes here each run. You can delete after day ends, or keep as history. -->
**2026-05-06 — Wire GameHUD into the gameplay loop**
GameHUD.tsx (speedometer, distance counter, wipeout screen) is a complete, export-ready component that is not rendered anywhere. Wire it into Experience.jsx by passing `vehicleRef` as `rigidBodyRef`; forward wipeout state from Player.jsx/RunnerVehicle.tsx; confirm speed reads from Rapier velocity in real time. This is the single change that transforms the prototype into something that reads like a game.

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [in progress — 2026-05-06] Wire GameHUD into Experience.jsx — GameHUD.tsx (speed, distance, wipeout) is complete but unwired; connect rigidBodyRef + wipeout state forwarding from Player/RunnerVehicle
- [ ] Author segments 0–12 waypoints in meander_to_waterfall.json — The Meander opener is fully procedural; explicit waypoints + environment hints would make the first impression deliberate (half-day)
- [ ] Reactive audio validation — confirm public/sounds/ files are real foley (not 477-byte stubs); test ReactiveAudio crossfades in browser; AudioSystem + ReactiveAudio are wired but silent until verified (half-day sourcing + smoke test)

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [ ] Verify RiverShader.js moss effect receives correct world normals from TrackSegment.jsx terrain mesh (visual check needed)
- [ ] Replace stub MP3s in public/sounds/ with real foley/audio assets (current files may be silent 477-byte placeholders — verify first)
- [ ] ReachManager architecture not documented in CLAUDE.md — significant new systems (ReachStreamer, ReachNormalizer, BiomeSystem, LODManager, SplashSystem, WaterReflection, WaterInteraction) need doc pass before onboarding new contributors

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
- [x] 2026-05-06 — Step 3 — Water Visual Quality: bankFoam via EDGE_FOAM_WIDTH + cameraHeight uniform + proximityScale wave turbulence confirmed in FlowingWater.jsx (commit 80fe84d)
- [x] 2026-05-06 — Step 6 — meander_to_waterfall.json validated end-to-end (PR #125): segments 13–22 fully authored with waypoints, biome overrides, checkpoints; JSONMapManager drives TrackManager
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
Date: 2026-05-06
Mode: New Idea — Ideas section exhausted (Step 3 water quality confirmed done in code; Step 5 already done); three new ideas generated
Focus: Wire GameHUD (speedometer / distance / wipeout) into Experience.jsx — component is complete but unrendered
Outcome: Dispatch produced. weekly_plan.md updated: Step 3 + Step 6 → Done; GameHUD wiring set as Today's focus; 2 unpicked ideas (authored Meander waypoints, audio validation) appended to Ideas.
