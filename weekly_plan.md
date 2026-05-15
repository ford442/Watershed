# Watershed — Weekly Plan

## Today's focus
<!-- Routine writes here each run. You can delete after day ends, or keep as history. -->
**2026-05-13 — Reactive audio validation: replace 477-byte stubs + verify pipeline end-to-end**
All 23 `public/sounds/` files are confirmed 477-byte silent placeholders. AudioSystem.ts, `useSegmentAudio`, and ReactiveAudio are fully wired (initAudio called in Experience.jsx, crossfade logic complete) but completely silent in-game. Today: synthesize minimal-valid PCM tones for each sound slot so the pipeline can be tested without real foley, audit the full init → preload → crossfade chain for timing issues, and add a dev-mode audio diagnostics overlay to make system state visible.

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [x] Wire GameHUD into Experience.jsx — done 2026-05-06; all acceptance criteria met per .swarm-state.md
- [x] Author segments 0–12 waypoints in meander_to_waterfall.json — done 2026-05-13; PR #130 merged (deterministic decoration placement + authored waypoints)
- [in progress — 2026-05-13] Reactive audio validation — confirm public/sounds/ files are real foley (not 477-byte stubs); test ReactiveAudio crossfades in browser; AudioSystem + ReactiveAudio are wired but silent until verified (half-day sourcing + smoke test)

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
- [x] 2026-05-13 — GameHUD wiring: speedometer, distance counter, wipeout overlay, respawn handler — all criteria met per .swarm-state.md; Experience.jsx renders GameHUD via vehicleRef + isWipeout
- [x] 2026-05-13 — Author segments 0–12: deterministic decoration placement + authored waypoints in meander_to_waterfall.json (PR #130 merged)
- [x] 2026-05-13 — Fix deprecated WebGLRenderTarget constructor for Three.js 0.168+ (PR #131)
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
Date: 2026-05-13
Mode: User Idea — last remaining Ideas item (reactive audio validation) picked; GameHUD + authored segments confirmed done
Focus: Replace 477-byte audio stubs with synthesized PCM tones; audit AudioSystem init → crossfade chain; add dev-mode audio diagnostics overlay
Outcome: Dispatch produced. weekly_plan.md updated: GameHUD wiring + authored segments 0-12 + WebGLRenderTarget fix → Done; audio validation marked in progress; Today's focus set.
