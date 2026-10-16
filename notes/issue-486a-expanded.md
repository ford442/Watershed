# #486 Phase A — `InputFrame` + `InputHub`: one polled input value for both vehicles, a scripted source for headless runs (closes #474)

Parent: #486. Phase A only. Gamepad (B), touch (C) and comfort (D) plug into what this lands. Expanded 2026-10-15 from three outside reviews (file list / plan, design stress-test, ecosystem check), each claim re-verified against `main` `9e9c746`. Where a review contradicted the tree, the tree wins and the correction is noted.

## What the code actually does today (verified)

- `src/hooks/usePlayerControls.ts` (197 lines) returns `{ forwardDir, rightDir, getControls }`. `getControls()` reads drei's `useKeyboardControls` store via `getKeys()`, raw refs for Q/E/Shift/Alt and a `Set` of pressed mouse buttons, then **builds a new object with a spread on every call**. It is called **twice per frame** by `RunnerPhysicsStep.ts:375` and `:513`, twice by `raftPhysicsRuntime.ts:309` / `:564`, once by `useRaftControls.ts:199`. `forwardDir` / `rightDir` are `.clone()`d on every render. So the "no per-frame allocation" bar is not a regression risk; it is a fix.
- **Mouse look is not in this hook.** The camera is driven by drei's `<PointerLockControls makeDefault>` at `InnerExperience.tsx:90`; `src/ui/SettingsLookSync.tsx` adds a capture-phase `mousemove` for invert-Y. No vehicle reads look deltas. (Review 1 assumed the hook owned look; it does not.)
- **Vehicle stepping is on the main thread.** `useRunnerControls.ts` calls `updateRunnerPhysics` inside `useFrame` with `useRapier().world`; the raft does the same through `raftPhysicsRuntime.ts`. `src/physics/rapier.worker.ts` never sees input. (Review 2's "input pipeline inside the physics worker" alternative does not apply; its "physics sub-steps read the frame several times" hazard does not apply either, because `@react-three/rapier` 2.2 steps once per `useFrame` with its own fixed `timeStep` default.)
- `isPointerLocked` is returned by the hook but **no vehicle gates on it** (grep in `src/vehicles` and `src/experience` is empty). Pointer lock matters only to `PointerLockControls` and `App.tsx:364` (pause on unlock).
- Pause: `App.tsx` `pointerlockchange` → pause; `PauseMenu.tsx:90` and `SettingsPanel.tsx:141` listen for `Escape` on `keydown`. Start: `App.tsx:450` `Enter`, `.start-menu-start-btn` click. Other `keydown` listeners: `GameHUD.tsx:262` (Enter on journey complete), `VehicleTuner.tsx:91`, `useNightMode.ts:42`, `App.tsx:334`. None of these are vehicle input and none change in Phase A.
- `useKeyboardControls` importers: `usePlayerControls.ts`, `VehicleTuner.tsx`, `settingsDerive.ts` (map derivation), `Experience.tsx:62` (`<KeyboardControls map={bindingsToDreiMap(bindings)}>`). Vehicles only reach it through `usePlayerControls`.
- Ghost: `GhostRecorder.ts` is a 10 Hz ring buffer (`GHOST_MAX_SAMPLES = 3000`, `sampleAccum`), `ghostCodec.ts` v3 = 7 delta-encoded floats per sample, `.wsghost` via `ghostExport.ts`. `SplitRecorder.ts` already records `{ segmentIndex, tMs, speed }` per `segment-enter` (`TrackManager.tsx:433`). **That split table is the #474 readout; Phase A only has to make it reachable from a headless run.**
- Headless harness: `verification/visual_smoke.mjs` waits for `.start-menu-start-btn`, clicks it, then uses `window.__watershedScreenshot` (defined at `useExperienceWorld.ts:382`, has `teleportToSegment`). `App.tsx:522` sets `frameloop="always"`.
- Lint: `@react-three/eslint-plugin` is active (`eslint.config.js:43`); `no-new-in-loop` is a warning today, 254 warnings total.

## Design (after the stress-test)

### `src/input/InputFrame.ts`
One plain object, preallocated, mutated in place by the hub, `Readonly<InputFrame>` to every reader.

| slot | field | type / range | notes |
|---|---|---|---|
| 0 | `moveX` | −1..1 | strafe (A/D) |
| 1 | `moveY` | −1..1 | forward/back (W/S); right-click-forward maps here |
| 2 | `lookDX` | px | **reserved, always 0 in Phase A** (look stays on `PointerLockControls`; Phase B owns it) |
| 3 | `lookDY` | px | reserved, 0 |
| 4 | `paddleL` | 0..1 | Q |
| 5 | `paddleR` | 0..1 | E |
| 6 | `buttons` | integer in a float32 slot (≤ 24 bits, 6 used) | `JUMP=1, SPRINT=2, BRAKE=4, DODGE=8, INTERACT=16, PAUSE=32` |
| 7 | `dtMs` | ms | the sim step this frame was produced for (fixes "input time ≠ physics time") |
| — | `tMs`, `frameIdx`, `source` | not encoded | `frameIdx` is the determinism key; `tMs = frameIdx × dtMs` |

`encodeInputFrame(frame, out: Float32Array, offset)` / `decodeInputFrame(src, offset, into)` write exactly 8 floats and allocate nothing. Store `buttons` as an integer in a float slot rather than a `uint32` view; a `Float32Array` cannot carry a raw `uint32` safely and 6 flags do not need it.

**`PAUSE` is in the live bitfield but is masked out of the ghost encoding** (`GHOST_BUTTON_MASK = ~PAUSE`). A replay must never pause the viewer's game. Pause stays a UI event on the main thread (today's `pointerlockchange` / `Escape` paths are untouched in Phase A); the bit exists so Phase C's on-screen button has somewhere to go.

### `src/input/InputHub.ts`
- `registerSource(source)` keyed by `source.id` (`'keyboard-mouse'`, `'scripted'`); registering an id that exists disposes the old one first. `unregisterSource(id)`. This is what survives React 19 strict-mode double effects.
- `tick(dtMs, frameIdx)` runs **once per frame at `useFrame` priority −100** from a null component `<InputHubTick />` mounted inside the Canvas. It asks each source to write its **own** per-device scratch (`move`, `paddle`, `buttons`), merges: stick = last-active device, buttons = OR of the per-device scratches, then clears every scratch. Per-device maps cleared each tick means a release on any device is honoured; OR-ing across ticks would not.
- `readFrame(): Readonly<InputFrame>` returns the same object every time. The two `getControls()` calls per frame in the runner step therefore see one snapshot. Carries `frameIdx` so a consumer can assert "same frame" in tests.
- Ghost latch: `latchForGhost()` accumulates `buttons |=`, `lookDX/DY +=` and a time-weighted mean of the axes across the frames in a 100 ms window; `consumeGhostLatch(into)` copies and resets. The recorder calls it from its existing 10 Hz accumulator; nothing else about the recorder's clock changes. (10 Hz sampling of raw frames would drop 30–60 ms jump taps; the latch is what makes 10 Hz sufficient.)
- Zustand slice exposes **only** `activeSourceId` and `isScripted`; never the frame. UI must not subscribe to per-frame data.
- No `for..of`, no closures, no spread in `tick` / `readFrame`; classic indexed loops over a preallocated source array.

### `src/input/sources/KeyboardMouseSource.ts`
The body of today's `usePlayerControls`: drei store `getKeys()` (the `<KeyboardControls map>` in `Experience.tsx` stays the keyboard *source*), the Q/E/Shift/Alt refs, the mouse-button set and `bindingsToMouseMap` lookup, `blur` clears, `contextmenu` suppression when `Mouse2` is bound. `attach()` / `detach()` are explicit methods, never constructor side effects. Booleans become axes: `moveX = (rightward ? 1 : 0) − (leftward ? 1 : 0)`, etc.

### `src/hooks/usePlayerControls.ts` becomes the adapter
Same exported signature. `getControls()` returns a **preallocated `PlayerControls` object** filled from `inputHub.readFrame()` (`forward = moveY > 0.5`, `paddleLeft = paddleL > 0.5`, …) — no spread. `forwardDir` / `rightDir` become stable `Vector3` instances mutated in place (callers already copy what they need; verify `RunnerPhysicsStep` and `raftPhysicsRuntime` do not hold the reference across frames). `isPointerLocked` stays as React state for the UI. Also exported as `useInputFrame()` for new code; `usePlayerControls` carries `@deprecated` JSDoc after the vehicles switch.

### `src/input/sources/ScriptedSource.ts` and `?input=script:<url>`
- Script format: `{ "version": 1, "dtMs": 16.6667, "frames": [[frameIdx, moveX, moveY, paddleL, paddleR, buttons], …] }` — keyframes with hold-until-next semantics, so a 40 s run is a few dozen rows, parsed once at load (no streaming needed at this size; a `.wsghost` v4 input track is the large case and is Phase B's `scripts/record-input.mjs`).
- **Pull model, sim-clocked.** The source does not run on wall time. `InputHub.tick(dtMs, frameIdx)` asks it for the frame at `frameIdx`; the hub is ticked by the sim clock, not by `performance.now()`. Under SwiftShader at 5 FPS the run is slower in wall time and identical in sim time.
- The source holds at `frameIdx = 0` until the run is live (the start button has been clicked and the vehicle body exists; use the same signal `GhostRecorder.start` uses).
- Pointer lock is not required for a scripted run: `App.tsx`'s pause-on-unlock is suppressed while `isScripted` (the only `App.tsx` change in this issue, two lines).
- **Deterministic stepping for CI.** When `?input=script:` is present the Canvas boots with `frameloop="never"` (`App.tsx:522`, one conditional) and `window.__watershedScreenshot` gains `stepScripted(n)`: advance `n` sim frames (hub tick → `advance()` on the R3F root so `useFrame` + Rapier step run) and render only on the last one. Splits come from `getSplits()` (reads `SplitRecorder`). This is the same test-API object the smoke already uses; no new global. Rendering every 60th frame is what turns a ~40 s SwiftShader run into a few seconds, which is what makes this a per-PR check instead of a nightly one.

### Ghost codec v4 (owned here; #468 D reuses it)
- `GHOST_CODEC_VERSION = 4`. Sample stride 7 → 15 floats: 7 pose (unchanged delta encoding) + 8 input (absolute, from the latch; `PAUSE` masked). `GHOST_BYTES_PER_SAMPLE` derives from the constant. `GHOST_MAX_SAMPLES` stays 3000 (buffer grows 84 KB → 180 KB; still fine for localStorage once base64, but assert the persisted size in a test).
- Decoder keeps a v3 branch (stride 7, input slots zero-filled). `importGhostFromJson`'s `codecVersion <= GHOST_CODEC_VERSION` rule already admits v1–v3 files; v4 must not break `ghostPB`, `ghostFairnessGate`, `hydroFairness` (they read pose + metadata only). `judgeGhostFairness` ignores the input track in Phase A.
- The recorder stores a **copy** of the latch each sample (it already writes into its own ring buffer; make sure the hub's latch object is never pushed by reference).

### `verification/input_script_smoke.mjs`
- Boots `?map=meander&input=script:/verification/fixtures/input/meander_run.json` the way `visual_smoke.mjs` does (same Chrome flags; add the explicit `--enable-unsafe-swiftshader` / `--use-angle=swiftshader` flags the ecosystem check says are now required instead of automatic fallback), clicks start, then `page.evaluate` loops `stepScripted(60)` for 40 sim-seconds, printing `getSplits()` and the runner pose + speed after each second.
- Asserts: a split for segment 3 exists, its `tMs` < 40 000, speed at every split > 0, and **two consecutive runs of the same script produce identical split `tMs` values** (that is the determinism contract #468 A needs; if it fails, print both tables).
- Fixture: forward held from frame 0, two strafe pulses to stay in the channel through segments 1–2, one jump at the seg-2 rock. Author it by hand against `src/maps/meander_to_waterfall.ts`; the camera heading is the spawn heading (track runs −Z), which is why look can stay out of Phase A.
- `package.json`: `test:input-smoke`; CI: added to the "Visual smoke (WebGL)" job after the pixel gate (it shares the Chrome install). If it comes in under 15 s it can move to every PR; decide after the first green run.

## Commits (keyboard play green at every step)

1. **`feat(input): InputFrame struct, button bits, 8-float codec`** — `src/input/InputFrame.ts` + test (round-trip, 24-bit button safety, PAUSE mask, zero allocation via `--expose-gc`-free check: run `encode` 10 000× and assert the same `out` array identity).
2. **`feat(input): InputHub + KeyboardMouseSource`** — hub, source, `<InputHubTick />`, tests with synthetic `KeyboardEvent` / `MouseEvent`: per-device clear semantics, id-keyed re-register under a simulated double effect, `readFrame()` identity across two reads in one tick, ghost latch OR/sum/mean.
3. **`refactor(controls): usePlayerControls reads the hub`** — adapter with preallocated return; mount `<InputHubTick />` in `InnerExperience.tsx` next to `PointerLockControls`; `VehicleTuner.tsx` keeps its own `useKeyboardControls` (it is a dev tool, not a vehicle). Gate: `grep -rn useKeyboardControls src/vehicles` empty; visual smoke baselines unmoved; `pnpm test` green.
4. **`feat(ghost): codec v4 carries the input track`** — stride 15, v3 branch, recorder uses the latch, size assertion, v3 fixture decode test, `ghostPB` / fairness tests untouched and green.
5. **`feat(input): ScriptedSource, ?input=script, stepScripted, input_script_smoke`** — source + test (frameIdx hold-until-next, hold-at-zero before run start), `App.tsx` frameloop conditional + pause-on-unlock suppression, `__watershedScreenshot.stepScripted/getSplits`, the fixture, the script, `package.json` + CI wiring.

## Acceptance

- [ ] `grep -rn useKeyboardControls src/vehicles` returns nothing; `RunnerPhysicsStep.ts`, `raftPhysicsRuntime.ts`, `useRaftControls.ts` read a `Readonly<InputFrame>` (through the adapter or `useInputFrame()`).
- [ ] `getControls()` and `readFrame()` return the same object identity on repeated calls within one frame (unit test); `src/input/` has zero `@react-three/no-new-in-loop` warnings and `pnpm lint` total stays ≤ 254.
- [ ] `node verification/input_script_smoke.mjs` exits 0 in CI: segment-3 split under 40 s sim time, positive speed at every split, two runs produce identical split times (closes #474).
- [ ] Keyboard play unchanged: `pnpm test:visual-smoke` passes with baselines unmoved; manual: WASD/Space/Shift/Q/E and right-click-forward behave as before; Escape still pauses; Enter still starts.
- [ ] Ghost v4 round-trips an input track; every existing v3 fixture in `ghostCodec.test.ts` and `ghostPB.test.ts` still decodes; `PAUSE` never appears in an encoded sample.
- [ ] Hub + keyboard source cost < 0.1 ms/frame (measure with the existing `profile:physics` pattern or a `performance.measure` around `tick` in the smoke, printed in the PR).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm exec vite build`, `pnpm test:visual-smoke` green.

## Decisions taken (were open questions)

1. **Fixed dt:** 1/60 s (`dtMs = 16.6667`) keyed by `frameIdx`, never wall time. When #468 A lands its accumulator the hub ticks once per sim step at that dt; nothing in Phase A assumes otherwise.
2. **CI cadence:** render-every-Nth-frame stepping makes the smoke seconds, not 40 s; start it in the Visual smoke job and promote to every PR once a green run shows the time.
3. **Ghost v4 here.** Reserving the 8-slot input block now avoids a v4-pose-only / v5-with-input churn. Fairness ignores the track until #468 D.
4. **`PAUSE` in the bitfield, masked from the codec.**
5. **Naming:** `useInputFrame()` is the new hook; `usePlayerControls()` stays as a deprecated adapter until Phases B–D retire the last caller.
6. **Rejected: event-sourced command log** (review 2's recommendation). Both vehicles already poll a snapshot every frame and apply continuous forces; a command log moves the merge rule into each consumer, allocates per event, and its one claimed win (replay fidelity) is obtained here by `frameIdx + dtMs` in the frame. Rejected: worker-side input pipeline — vehicles step on the main thread.
7. **Look stays on `PointerLockControls` in Phase A.** The `lookDX/lookDY` slots are reserved so the codec does not change again in Phase B, when gamepad look needs a source that is not a DOM `mousemove`.

## Out of scope

Gamepad, touch, haptics, comfort (B–D). Weather / seeded PRNG (#468). Any file owned by the #485 session this week: `vite.config.ts`, `index.html`, `public/.htaccess`, `scripts/check-build-manifest.mjs`, `src/materials/`, `src/physics/rapier.worker.ts`, `src/utils/*Validator.ts`, `src/formats/`, the debug-tool lazy-mount sites.

## Risks

- `RunnerPhysicsStep` / `raftPhysicsRuntime` may hold `forwardDir` across frames; if so the in-place `Vector3` change leaks state. Check before commit 3; fall back to copying into a step-local scratch.
- Strict mode: `<InputHubTick />` registering twice is harmless (idempotent by id); a source attaching DOM listeners twice is not. The attach/detach test is the guard.
- `frameloop="never"` + `advance()` under `@react-three/rapier`: confirm the physics step runs inside `advance()` (it is a `useFrame` subscriber, so it should); if the Rapier `updateLoop` is `"independent"` anywhere, the scripted run must set `"follow"`.
- Script fixture authoring is the only hand-tuned part; if segment 3 cannot be reached without look input, add a single absolute `headingYaw` keyframe field to the script and apply it to the camera when scripted (still no `lookDX` source).
