# Watershed — Weekly Plan

## Today's focus
**2026-06-10 — Fix First: WASM build pipeline regression (hotfixed) + hardening**

`npm run build` was broken on this branch: commit `b63abac` (2026-06-06) reordered `emscripten/build.sh` so `source /root/emsdk/emsdk_env.sh` ran under `set -euo pipefail` *before* the `command -v emcc` graceful-skip check, so the script (and therefore `npm run build`) exited 1 on any host without Emscripten at exactly `/root/emsdk/` — breaking the build/deploy pipeline (`build_and_patch.py` → `deploy.py`). **Already hotfixed this run** (commit `5496c14`): restored portable `emsdk_env.sh` discovery (checks `$REPO_ROOT/emsdk`, `$HOME/emsdk`, `/usr/local/emsdk`, `/opt/emsdk`, `/root/emsdk`) ahead of the skip-and-exit-0 check; verified `bash emscripten/build.sh` and `--threads` both exit 0 cleanly. Remaining work for today hardens this so it can't silently regress again: apply the same portable-discovery pattern to `emscripten/build_colab.sh`, and add a CI job that runs `npm run build` on a runner WITHOUT Emscripten installed (the exact missing case that let this regression slip through unnoticed for 4 days).

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
- [x] Runner sprint stamina HUD feedback — done 2026-06-03; PR #211 merged (Zustand stamina store, speed-reactive vignette intensity in RunnerVehicle, HUD stamina bar)
- [ ] Authored environmental set-pieces — rock launch shelf geometry at waterfall (segment 14), crumbling pillar formation at slot canyon exit (segment 22); unique per-segment decoration passes beyond the procedural baseline

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [ ] Verify RiverShader.js moss effect receives correct world normals from TrackSegment.jsx terrain mesh (visual check needed)
- [ ] ReachManager architecture not documented in CLAUDE.md — significant new systems (ReachStreamer, ReachNormalizer, BiomeSystem, LODManager, SplashSystem, WaterReflection, WaterInteraction) need doc pass before onboarding new contributors (note: SYSTEMS.md now exists and is referenced from CLAUDE.md — verify it actually covers these systems before closing this item)
- [ ] WASM build portability hardening — `emscripten/build.sh` regression hotfixed 2026-06-10 (commit 5496c14, see Done); still need: same portable emsdk_env.sh discovery applied to `emscripten/build_colab.sh`, and a CI job that runs `npm run build` WITHOUT Emscripten installed so this regression class can't recur silently (today's kimi-cli focus)
- [ ] CLAUDE.md "Known split" warning (BiomeProvider/EnhancedSky reads legacy prop) is now stale — confirmed EnhancedSky.jsx:5,126 already calls useBiome() as of PR #180 series; warning should be removed from CLAUDE.md + SYSTEMS.md to avoid misleading future contributors
- [ ] PR #212 (open, draft since 2026-06-06) fixes a real crash: `mergeCompatibleGeometries` throws on mismatched geometry attributes across 6 Environment components (TreeAssets, DebrisAssets, Ferns, Reeds, Wildflowers, Dragonflies) → uncaught TypeError → ErrorBoundary trip → WebGL context loss. The fix is complete and correctly scoped (confirmed no other component shares the vulnerable pattern), but unverified — test-plan checkboxes unchecked for 4 days. Needs in-browser verification + merge (today's Claude Code whole-stack task)

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
- [x] 2026-06-10 — Hotfix: restored graceful WASM build skip in `emscripten/build.sh` — a 2026-06-06 regression (commit b63abac) had reordered `source /root/emsdk/emsdk_env.sh` before the `command -v emcc` check under `set -euo pipefail`, causing `npm run build` to exit 1 on any host without Emscripten at that exact path. Restored portable emsdk_env.sh discovery (5 candidate paths) ahead of the graceful skip-and-exit-0 check; verified both `build.sh` and `build.sh --threads` exit 0 cleanly (commit 5496c14).
- [x] 2026-06-06/07 — PR #213 merged (Jules): refactored `TrackSegment.jsx`, `RunnerVehicle.tsx`, `RaftVehicle.tsx` (all >1000 lines) into smaller modules under 700 lines — new `TrackSegment/` (index.jsx, TrackSegmentMeshes.jsx, PondFog.jsx, hooks/), `RunnerVehicle/` and `RaftVehicle/` subdirectories with constants/audio/physics hooks split out; also added pond fog VFX, raft paddle/splash/collision audio, runner footstep/jump/landing audio, and camera shake.
- [x] 2026-06-03/04 — Delta biome authored as game conclusion (5 deliverables, .swarm-state.md, 147/147 tests pass): `TrackBiomeId` extended with `'delta'` + `TRACK_BIOMES.delta` profile; segments 31–38 authored in `meander_to_waterfall.ts` (Delta Approach → Delta Entry → Wide Delta → Final Stretch → segment 38 `journeyComplete: true`); `GameState.ts` gained `isJourneyComplete`/`setJourneyComplete` (finalizes high score on completion); `TrackManager.jsx` fires the trigger via `getChunkConfig`; `GameHUD.tsx` renders a "Journey Complete" overlay (final score, high score, top speed, restart). Resolves the "delta biome unreachable" backlog item — the game now has an authored ending.
- [x] 2026-06-03 — PR #211 merged: runner sprint stamina (Zustand store) + speed-reactive vignette intensity in RunnerVehicle + HUD stamina bar in GameHUD.
- [x] 2026-06-05 — Early-game segments: Glacier Ice Run (-3) and Alpine Wildflower Stream (-2 to -1) authored in `meander_to_waterfall.ts`; `GLACIER_START_INDEX` updated to -3; `startIndex` wired through `TrackManager`/`ChunkManager`; `Experience.jsx` default start now chains glacier → alpine → meander; wildflower spawn boost tied to `particleCount` in `TrackSegment.jsx`; `LEVEL_DESIGN.md` updated with parameters and QA cases.
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
Date: 2026-06-10
Mode: Fix First — `npm run build` was broken on this branch (emscripten/build.sh regression from 2026-06-06 commit b63abac exits 1 without Emscripten at /root/emsdk/, breaking the whole build/deploy pipeline); a known crash-fix (PR #212) has also sat as an unverified draft for 4 days
Focus: WASM build pipeline hardening — immediate regression already hotfixed (commit 5496c14, verified exit 0); kimi-cli's swarm task extends the fix to build_colab.sh and adds a CI job that builds without Emscripten so this can't recur silently
Outcome: Hotfix committed. Done updated with last week's actual landed work (delta biome conclusion — segments 31–38 + Journey Complete overlay, 147/147 tests; PR #211 sprint stamina; PR #213 large-file refactor). Backlog updated: delta-unreachable item resolved/removed; WASM item narrowed to remaining hardening; new item added for open draft PR #212 (mergeBufferGeometries crash/WebGL-context-loss fix, unverified) — assigned to today's Claude Code whole-stack task. "Authored environmental set-pieces" remains the top User Idea for next run. Dispatch produced for kimi-cli/Copilot/Gemini/Kimi/Grok/Jules.
