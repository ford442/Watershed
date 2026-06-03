# Watershed — Weekly Plan

## Today's focus
**2026-06-03 — Author the delta biome as the game's conclusion (segments 31–38)**

`BiomePalettes.ts` already has a fully-specified `delta` palette (wide water, sediment color, sunset orange/gold fog), but `TrackBiomeId` only lists `'summer' | 'autumn' | 'slotCanyon'` — delta is unreachable. After segment 30 the progression falls to the `19+ catch-all (autumn rapids)`, so the run has no ending. Today's work: (1) add `'delta'` to `TrackBiomeId` and `TRACK_BIOMES`; (2) author segments 31–38 in `meander_to_waterfall.ts` (widening channel, calming current, sunset palette blend, raft-mode suggestion text); (3) add a "Journey Complete" terminal state in `GameState.ts` that fires when the player crosses segment 38; (4) display a simple end-screen overlay in `GameHUD.tsx`. Acceptance: player who reaches segment 31 sees sky/fog shift to warm sunset, by segment 38 sees the "Journey Complete" card, and the score is finalized + written to high score.

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [x] Wire GameHUD into Experience.jsx — done 2026-05-06; all acceptance criteria met per .swarm-state.md
- [x] Author segments 0–12 waypoints in meander_to_waterfall.json — done 2026-05-13; PR #130 merged (deterministic decoration placement + authored waypoints)
- [x] Reactive audio validation — done 2026-05-27: all 23 MP3 stubs replaced with valid 1-second sine tones (17,180 bytes each), AudioDiagnosticsOverlay.tsx wired into Experience.jsx behind DEV gate, AudioSystem.ts updated with getLoadStatus/getActiveSounds diagnostics APIs; confirmed by .swarm-state.md
- [x] In-scene Level Editor — done 2026-05-20: PR #151 merged; LevelEditor wired via ?editor=1, useLevelEditor.ts hook + levelEditorValidator.ts added; Option A (overlay on game Canvas) selected
- [ ] Runner sprint stamina HUD feedback — stamina bar in GameHUD, speed-reactive vignette intensity when sprinting in RunnerVehicle
- [ ] Authored environmental set-pieces — rock launch shelf geometry at waterfall (segment 14), crumbling pillar formation at slot canyon exit (segment 22); unique per-segment decoration passes beyond the procedural baseline

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [ ] Verify RiverShader.js moss effect receives correct world normals from TrackSegment.jsx terrain mesh (visual check needed)
- [ ] ReachManager architecture not documented in CLAUDE.md — significant new systems (ReachStreamer, ReachNormalizer, BiomeSystem, LODManager, SplashSystem, WaterReflection, WaterInteraction) need doc pass before onboarding new contributors
- [ ] WASM build requires Emscripten SDK at `/content/buil*/emsdk/` (hardcoded path in build.sh) — needs portable emsdk_env.sh discovery or CI matrix
- [ ] CLAUDE.md "Known split" warning (BiomeProvider/EnhancedSky reads legacy prop) is now stale — EnhancedSky.jsx uses useBiome() as of PR #180 series; warning should be removed from CLAUDE.md + SYSTEMS.md to avoid misleading future contributors
- [ ] `delta` biome palette exists in BiomePalettes.ts but `TrackBiomeId` only lists summer/autumn/slotCanyon — delta is unreachable; segments 31+ fall to autumn catch-all; game has no authored conclusion (today's focus addresses this)

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
- [x] 2026-06-03 — PRs #179–181 (Movement Polish + Canyon Expansion epic): raft stamina/brake/dynamic-camera/wake-VFX; slot canyon segment with god rays/mist/biome fix; ScoreSystem.ts fully wired into GameHUD + Experience.jsx (score, multiplier, combo label, high score, top speed)
- [x] 2026-05-27 — npm run build fix: emcc graceful skip in emscripten/build.sh — exits 0 without Emscripten installed (confirmed via .swarm-state.md)
- [x] 2026-05-27 — WatershedWasm buoyancy integration: FloatingObjectManager uses wasmModule.computeBuoyancy() with JS fallback; WatershedWasm.ts uses new Function() trick to avoid Vite static analysis (confirmed via .swarm-state.md, 123 tests pass)
- [x] 2026-05-27 — Reactive audio validation: all 23 MP3 stubs replaced with valid 1-second sine tones (17,180 bytes); AudioDiagnosticsOverlay.tsx DEV-gated overlay; AudioSystem.ts diagnostics APIs (getLoadStatus, getActiveSounds, getAudioContextState); confirmed by .swarm-state.md
- [x] 2026-05-27 — In-scene Level Editor wiring: PR #151 merged; LevelEditor overlay via ?editor=1, useLevelEditor.ts hook + levelEditorValidator.ts
- [x] 2026-05-27 — Downhill creek → second waterfall (segments 23–30): PR #153 merged; meander_to_waterfall.ts extended, RunnerVehicle updated, WaterfallParticles + FlowingWater tuned
- [x] 2026-05-27 — Physics stability: PRs #154–156 — NaN guards on FloatingObjectManager impulses, Set iteration fix on InstancedRigidBodies, XY spawn variation in INITIAL_POINTS
- [x] 2026-05-27 — WASM module (partial): C++/Emscripten module authored in emscripten/ + WatershedWasm.ts bindings + Jest tests; RTTI/Embind conflict resolved (PR #159); binary not yet compiled
- [x] 2026-05-20 — ReactiveAudio NaN volume fix: comprehensive isFinite guards on all volume paths (PR #144)
- [x] 2026-05-20 — R3F Html namespace fix: LoadingDisplay/ErrorDisplay wrapped with drei <Html> to prevent "Div is not part of THREE namespace" error (PR #143)
- [x] 2026-05-20 — Player spawn alignment: spawn position aligned to first canyon chunk, strafe keys mapped to KeyboardControls leftward/rightward, Rapier handle Set iteration fixed (PRs #145–147)
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
Date: 2026-06-03
Mode: New Idea — Ideas list exhausted; all 4 user ideas completed; PRs #179–181 merged between runs (raft polish, slot canyon, ScoreSystem) — foundation solid
Focus: Author delta biome as game conclusion — segments 31–38, TrackBiomeId extension, "Journey Complete" terminal state in GameState.ts, end-screen in GameHUD.tsx
Outcome: Dispatch produced. Done section updated with PRs #179–181 + last week's WASM/build fixes confirmed. Backlog updated (stale CLAUDE.md warning flagged, delta gap flagged). 2 new ideas appended to Ideas.
