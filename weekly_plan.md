# Watershed — Weekly Plan

## Today's focus
<!-- Routine writes here each run. You can delete after day ends, or keep as history. -->
**2026-05-20 — Complete reactive audio validation: synthesize valid PCM tones for all 23 public/sounds/ stubs + add dev-mode AudioDiagnosticsOverlay**
All 23 `public/sounds/` files remain 477-byte ID3v2 stubs. ReactiveAudio NaN volume is fixed (PR #144), spawn/physics are stable (PRs #145–147), and the AudioSystem init → crossfade chain is wired. Today: generate minimal valid MP3/WAV files for each sound slot (synthesized tones via ffmpeg or pure Python) so the audio pipeline can be smoke-tested in-game, then add `AudioDiagnosticsOverlay.tsx` gated behind `import.meta.env.DEV` showing AudioContext state, buffer load status, active sounds, and crossfade volumes.

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [x] Wire GameHUD into Experience.jsx — done 2026-05-06; all acceptance criteria met per .swarm-state.md
- [x] Author segments 0–12 waypoints in meander_to_waterfall.json — done 2026-05-13; PR #130 merged (deterministic decoration placement + authored waypoints)
- [in progress — 2026-05-20] Reactive audio validation — all 23 public/sounds/ stubs still 477 bytes; ReactiveAudio NaN volume fixed (PR #144), spawn/physics bugs fixed (PRs #143–147); pipeline now stable enough to synthesize PCM tones and smoke-test full audio chain; diagnostics overlay still needed
- [ ] In-scene Level Editor — wire LevelEditor scaffold (PathVisualizer, SegmentInspector, BiomeSelector in src/components/LevelEditor/) into dev-mode; LevelEditor.tsx currently has its own standalone Canvas — needs architectural decision (overlay on game Canvas vs. full editor mode swap); PathVisualizer already implements CatmullRom line + difficulty gradient; SegmentInspector has full property editor; BiomeSelector has biome grid; just needs wiring + dev gate + JSON export textarea

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
- [x] 2026-05-20 — ReactiveAudio NaN volume fix: comprehensive isFinite guards on all volume paths (PR #144)
- [x] 2026-05-20 — R3F Html namespace fix: LoadingDisplay/ErrorDisplay wrapped with drei `<Html>` to prevent "Div is not part of THREE namespace" error (PR #143)
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
Date: 2026-05-20
Mode: User Idea — audio validation item still in progress (stubs unresolved, pipeline fixed); audio picked as primary kimi-cli target; Level Editor wiring added to Ideas as routine-generated parallel idea for Copilot
Focus: Synthesize valid PCM tones for 23 public/sounds/ stubs; add AudioDiagnosticsOverlay; smoke-test full audio pipeline in-game
Outcome: Dispatch produced. Done section updated with PRs #143–147. Audio validation re-dated + clarified in Ideas. Level Editor wiring added to Ideas. weekly_plan.md updated.
