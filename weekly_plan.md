# Watershed — Weekly Plan

## Today's focus
**2026-06-17 — Fix First: close the F-2/F-3/F-4 bugs blocking the issue #240 live smoke test**

Noah spent the last two days (commits `6d72ff3`, `ec4b6b8`, `60211a4`, all direct pushes to this branch on 2026-06-15/16) building exactly what issues #240 and #241 ask for: a `?screenshot=1` Puppeteer harness (`verification/webgl_screenshots.mjs`), a `cleanTestMode` URL flag (`src/utils/cleanTestMode.ts`), and a `resetRunSession` helper to stop audio/weather/biome sticking in end-of-map state (`src/utils/resetRunSession.ts`) — and self-documented the results in a new "Known issues / friction log" in `docs/TESTING.md` (F-1 through F-7). The latest run (`verification/webgl/capture_report.json`, 2026-06-15) scored **0/7 good frames** and surfaced two live page errors: `linearRampToValueAtTime ... non-finite` and `firstElem.toArray is not a function`. Root cause for the Gate-level item (F-2) is confirmed: `Experience.jsx:526-539` (`teleportToSegment`) moves the rigid body directly via Rapier and never dispatches the `segment-enter` event or calls `ChunkManager`'s `onSegmentEnter` (`TrackManager.jsx:205`, `ChunkManager.ts:405`) — so teleporting for screenshots skips all the incremental segment-enter state setup that flow sampling (`WaterFlowForces.tsx:300,301,340` — `closestSample.point.toArray()`) and the reactive-audio crossfade depend on, which is the likely source of both F-3 and F-4. Build (`npm run build`) and the unit suite (179/179) are green — the foundation isn't broken — but the smoke-test pipeline Noah built specifically to validate the first map is not yet producing a single good in-game frame, and that's the explicit gate before #241's polish pass and before any new map-authoring work. Fix F-2 first (wire teleport → synthetic segment-enter, per Noah's own suggested fix in the friction log), then re-run the harness to see whether F-3/F-4 clear on their own or need separate NaN/shape guards.

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
- [ ] Authored environmental set-pieces — rock launch shelf geometry at waterfall (segment 14), crumbling pillar formation at slot canyon exit (segment 22); unique per-segment decoration passes beyond the procedural baseline (still not started — deferred again this week by the smoke-test Fix First)

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [ ] Verify RiverShader.js moss effect receives correct world normals from TrackSegment.jsx terrain mesh (visual check needed) — carried over again, still nobody has done the visual check
- [ ] ReachManager architecture doc pass — SYSTEMS.md now exists and does cover ReachStreamer/ReachNormalizer/BiomeSystem/LODManager/SplashSystem with contract cards; close this out (verified this run, looks complete — WaterReflection/WaterInteraction still not covered by their own contract cards in SYSTEMS.md, minor gap)
- [ ] CLAUDE.md "Known split" warning re-check — SYSTEMS.md's BiomeSystem.tsx contract card *still* documents the EnhancedSky/BiomeProvider legacy-prop split as "Known Pain" (not stale — confirmed current as of this run)
- [ ] Issue #240 — Live browser smoke test + repeatable full first-map run: open, blocked on F-2/F-3/F-4 below (today's Fix First)
- [ ] Issue #241 — Small runtime/polish items for clean live test: open; cleanTestMode.ts + resetRunSession.ts landed this week (real progress), but DebugPanel "clean test" wiring and the FlowingWater onBeforeCompile fallback-spam check are unconfirmed
- [ ] F-2 (Gate, docs/TESTING.md:325) — `teleportToSegment` (Experience.jsx:526-539) never fires `segment-enter`/`onSegmentEnter`, so Journey Complete and biome transitions can't be verified via the screenshot harness — today's Fix First, root cause confirmed
- [ ] F-3 (Medium, docs/TESTING.md:326) — `firstElem.toArray is not a function` when teleporting far downstream; likely `closestSample.point` in WaterFlowForces.tsx:300/301/340 getting a non-Vector3 shape when segment-enter setup was skipped — investigate alongside F-2 fix
- [ ] F-4 (Medium, docs/TESTING.md:327) — `linearRampToValueAtTime` non-finite AudioParam; sanitize speed/flow inputs feeding the reactive-audio crossfade (consumed via AudioSystem.ts:540 `setReactiveVolumes`, applied in ReactiveAudio.tsx) before the Web Audio ramp call
- [ ] F-1 (Gate, docs/TESTING.md:324, already mitigated) — headless first-person WebGL screenshots are sky-only under SwiftShader; Noah's own workaround (topdown camera + prestart frames in webgl_capture.py) is in place — no action needed, just don't regress it
- [ ] "Authored environmental set-pieces" idea (see Ideas) — now two weeks deferred behind infra/testing work

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
- [x] 2026-06-15/16 — Smoke-test infra for issues #240/#241 (partial, in progress): `cleanTestMode.ts` (+ test) for `?cleanTest=1`/`?screenshot=1` overlay hiding; `resetRunSession.ts` to stop audio/weather/biome sticking in end-of-map state on journey-loop restart; `verification/webgl_screenshots.mjs` (Puppeteer) + `verification/webgl_capture.py` (Playwright, topdown workaround for SwiftShader sky-only frames) capture harnesses; `docs/TESTING.md` "Known issues / friction log" (F-1–F-7) documenting exactly what's still broken. Surfaced real bugs (F-2/F-3/F-4) — see Backlog, today's Fix First.
- [x] 2026-06-11 — WASM build hardening completed (PRs #223, #224): graceful `emcc` skip restored in `build.sh`; pthread worker check updated for modern Emscripten's embedded-worker mode. Combined with the CI `build-without-emscripten` job already in `.github/workflows/build.yml` and the portable `emsdk_env.sh` discovery already in `build_colab.sh`, last week's WASM hardening backlog item is now fully resolved.
- [x] 2026-06-10/11 — PR #212 merged: fixed `mergeCompatibleGeometries` crash on mismatched geometry attributes across 6 Environment components (TreeAssets, DebrisAssets, Ferns, Reeds, Wildflowers, Dragonflies) that was causing ErrorBoundary trips / WebGL context loss.
- [x] 2026-06-10/11 — PR #221: fixed `isSlotCanyon is not defined` crash in `TrackSegment/` introduced by the prior week's large-file refactor (PR #213).
- [x] 2026-06-10/11 — PR #219: toggleable WebGPU/WebGL2 renderer with debug helpers (`?renderer=webgl` query param now load-bearing for the smoke-test harness above). PR #218: docs accuracy pass on markdown validator. PR #220: Cursor Cloud dev environment setup notes in AGENTS.md.
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
Date: 2026-06-17
Mode: Fix First — `npm run build` and the unit suite (179/179) are both green, so the foundation itself isn't broken, but Noah's own 2-day smoke-test build-out for issues #240/#241 (commits 6d72ff3/ec4b6b8/60211a4) scored 0/7 good frames in its latest capture report and self-documented 3 unresolved bugs (F-2 Gate, F-3/F-4 Medium) in docs/TESTING.md
Focus: Close F-2 first — `teleportToSegment` (Experience.jsx:526-539) bypasses the segment-enter event pipeline entirely, which is the likely root cause feeding F-3 (WaterFlowForces.tsx toArray crash) and F-4 (non-finite AudioParam ramp) too. Re-run `verification/webgl_screenshots.mjs` after the fix to see what's left.
Outcome: weekly_plan.md updated — Done backfilled with everything that actually landed since 2026-06-10 (WASM hardening fully closed via PRs #223/#224, PR #212 crash fix merged, PR #221 regression fix, renderer toggle + docs PRs); Backlog rewritten around the live F-1–F-4 friction log instead of stale items (RiverShader moss check and "Authored environmental set-pieces" both carried over untouched a second week — flagging that they're stalling). Dispatch produced for kimi-cli/Copilot/Gemini/Kimi/Grok/Jules targeting the F-2/F-3/F-4 fix as today's deep work, with a distinct GitHub issue drafted for Copilot on the "Authored environmental set-pieces" idea so it stops stalling.
