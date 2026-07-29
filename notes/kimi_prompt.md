# Kimi / AI Prompt for WATERSHED Contributions (Updated Vision)

**Project**: https://github.com/ford442/Watershed  
**Goal**: Build WATERSHED as a fast-paced, player-movement-focused downhill action game with varied biome runs. Follow **AGENTS.md** *strictly* at every step.

---

## UPDATED VISION (MUST ALIGN ALL WORK TO THIS)

**Core Gameplay Loop**:
- **Main experience** = Fast-paced **downhill runs** with strong visual identity per biome (e.g. elaborate autumn leaves run, glacier ice run, summer rapids, etc.).
- **Player movement** is the star: jumping, dodging, climbing, going with/against water flow, navigating slippery surfaces — pure skill-based action.
- **Floating objects** (logs, tires, small boats, debris) are dynamic platforms you can jump on/off and use creatively.
- **Raft / larger boats** exist **only** in non-downhill **transition segments** (calmer waterway sections between downhill runs). These are brief scenic moments with light problem-solving / puzzle + action.
- **No monsters or enemies** ever.
- Levels can alternate between intense downhill action and calmer non-downhill transition segments.
- Goal: Make every run feel distinct and memorable through biome variety and movement challenges.

**Key Principles**:
- Player is almost always moving on their own power or short-lived floating objects.
- Raft sections are rare, short, and cinematic — not the default mode.
- Biome identity (visuals + surface feel) drives level design.
- Keep the high-octane downhill energy while adding variety through puzzle/action in transitions.

---

## CRITICAL RULES FROM AGENTS.md (MUST FOLLOW)

- Use **functional components + hooks only** (no class components).
- Wrap **all shader injection** in `try { ... } catch`.
- **Validate geometry** before creation (no NaN, no zero/negative lengths).
- **Staged rendering**: return `null` until textures/paths ready.
- **Null-safe material creation**.
- **Safe buffer access** — check `positions.count` before iterating.
- Performance targets: **60 FPS locked**, frame time < 16.67 ms, memory < 300 MB.
- Use `useMemo` for expensive geometry/materials, `useFrame` for updates.
- Import order: React → R3F → internal utils → relative components.
- All new code must pass: `npm test`, visual regression (`python3 verify_visuals_playwright.py`), and the manual checklist in AGENTS.md.
- Player must spawn at `[0, -4, -10]`, track generates in -Z direction, no console errors, textures load.
- **Never** touch legacy files like `webpack.config.js`.

---

## OVERALL WORKFLOW (Do one goal at a time)

1. Create a new branch: `git checkout -b feature/goal-0-fix-live-build` (or similar).
2. Implement **only** the files for that goal.
3. Run full test suite + manual QA checklist after every major change.
4. Update `src/PLAN.md`, `src/LEVEL_DESIGN.md`, and any relevant docs.
5. Commit with clear message referencing the goal.
6. Open a GitHub Issue or PR with screenshots/FPS numbers.

---

## GOAL 0: Fix Live Build Issues (HIGHEST PRIORITY - Current Blockers)

**Current Problems on https://test.1ink.us/watershed/index.html**:
- Multiple audio 404 errors (jump, land_soft, step_rock, collide_rock)
- WebGL `glBlitFramebuffer` errors (depth/stencil conflicts)
- Aggressive LOD downgrading (FPS dropping to 31–42, quality going high → medium → low)

**Files to create/edit**:
- `src/systems/AudioManager.ts` (or equivalent sound loading file)
- `src/systems/PostProcessing.tsx`
- `src/systems/LODManager.tsx`
- Possibly `src/Experience.jsx` or render pipeline

**Specific Tasks**:

### 0.1 Audio Fixes (Quick Win)
- Add placeholder silent `.mp3` files for: `jump.mp3`, `land_soft.mp3`, `step_rock.mp3`, `collide_rock.mp3` in the `public/sounds/` folder (or wherever deployed).
- Or disable loading of these specific sounds gracefully.
- Update AudioManager to wrap sound loading in try-catch and log warnings instead of hard errors.
- Goal: Zero audio 404s in console.

### 0.2 Fix glBlitFramebuffer Errors
- Locate the source of the blit operation (most likely in `PostProcessing.tsx`, custom render targets, or shadow map setup).
- Common fixes:
  - Ensure read and write depth/stencil attachments are **different** textures.
  - Avoid using the same render target for both source and destination in `glBlitFramebuffer`.
  - Check WebGL2 / WebGPU compatibility for depth formats.
  - Temporarily disable post-processing effects to isolate the issue.
- Goal: No more `GL_INVALID_OPERATION` errors related to blit.

### 0.3 Improve Baseline Performance & LOD Behavior
- Raise initial quality settings or reduce starting scene complexity (fewer particles, lower shadow resolution, lighter post-processing).
- Make LOD downgrading less aggressive (e.g., only downgrade after sustained low FPS for several seconds).
- Add better FPS monitoring and automatic quality recovery when FPS improves.
- Optimize initial load (staged asset loading, reduce draw calls on startup).
- Goal: Game stays at **"high" or "medium"** quality for at least 60 seconds on the test build without dropping below 45 FPS.

**Verification for Goal 0**:
- Open https://test.1ink.us/watershed/index.html in Chrome
- Console should show **zero** audio 404 errors
- No WebGL `glBlitFramebuffer` errors
- FPS stays ≥ 45 for extended play (no aggressive downgrading)
- Update `src/PLAN.md` with "Live build issues resolved"

---

## GOAL 1: Core Systems (Highest Impact)

**Files to create/edit**:
- `src/systems/ChunkManager.ts` (new)
- `src/systems/ObjectPool.ts` (new or enhance `ParticlePool.ts`)
- `src/systems/GameState.ts` (new)
- `src/physics/WaterForces.ts` (new)
- `src/shaders/water.wgsl` (new)
- `src/shaders/flowmap.wgsl` (new)
- `src/hooks/useChunkLoader.ts` (new)
- Update `src/Experience.jsx` and `src/systems/index.ts`

**Step-by-step instructions**:

### 1.1 ChunkManager.ts
Create a treadmill system with these constants:
```ts
export const GENERATION_THRESHOLD = 150;
export const MAX_ACTIVE_SEGMENTS = 7;
export const POOL_SIZE = 10;
export const RECYCLE_MARGIN = 70;
```
- Support both **downhill action segments** and **non-downhill transition segments**.
- Use `ReachStreamer.ts` + `ReachManager.tsx` as reference.

### 1.2 ObjectPool.ts
Generic reusable pool for floating objects, particles, and platforms.

### 1.3 GameState.ts
Store: `playerPosition`, `currentSpeed`, `currentBiome`, `isInTransitionSegment`, `isPaused`, `distanceTraveled`, `currentRunType` ("downhill" | "transition").

### 1.4 WaterForces.ts
Calculate forces for water flow. Apply to **player** and to **floating objects** (not just raft).

### 1.5 Shaders (WebGPU)
- `water.wgsl`: Heightmap + flowmap + normals.
- `flowmap.wgsl`: Water advection.

Wrap all shader code in try-catch.

**Verification for Goal 1**:
- `npm run dev` runs cleanly.
- FPS > 55 with many dynamic floating objects.
- Track generates smoothly in -Z.
- Update `src/PLAN.md`.

---

## GOAL 2: Player Movement + Floating Objects System (Core Gameplay)

**Files**:
- `src/components/Player.tsx` (new — focus on movement)
- `src/components/FloatingObject.tsx` (new — logs, tires, boats, debris)
- `src/hooks/usePlayerControls.ts` (new — WASD, jump, climb, slide)
- `src/physics/PlayerPhysics.ts` (new)
- Update `src/Experience.jsx`

**Tasks**:
1. Implement responsive player controls: run, jump, dodge, climb on slippery surfaces, interact with water flow.
2. Create dynamic floating objects that move with current and can be stood on / jumped between.
3. Player can jump on/off floating objects fluidly.
4. Add slippery surface physics and flow resistance/boost mechanics.
5. Death/respawn system (fall too far or miss platform).

**Verification**:
- Player feels fast and responsive on downhill runs.
- Jumping between floating objects works cleanly.
- No raft required for normal play.
- Player spawns at `[0, -4, -10]`.

---

## GOAL 3: Varied Biome Downhill Runs + Transition Segments

**Files**:
- Enhance `src/systems/LevelLoader.tsx` and `ReachNormalizer.ts`
- Update `src/LEVEL_DESIGN.md` (make it a template for multiple runs)
- Create `src/BIOMES.md` (new — define visual/mechanical identity per biome)

**Tasks**:
- Create a **template system** for downhill runs (e.g. Autumn Leaves Run, Glacier Ice Run).
- Each run has unique:
  - Visuals (trees, particles, lighting, water color)
  - Surface feel (slippery ice vs leafy friction)
  - Challenge types (jumps, dodges, flow navigation)
- Implement **non-downhill transition segments**:
  - Calmer water
  - Problem-solving / light puzzle elements
  - Brief scenic raft moments (optional, short, cinematic)
  - Action moments without combat (e.g. timed jumps, balance challenges)
- Allow alternating between downhill action and transition segments.

**Verification**:
- Easy to create new biome runs.
- Transition segments feel distinctly calmer and puzzle-oriented.
- Raft only appears in transition segments and feels optional/scenic.

---

## GOAL 4: UI/HUD + Menus

**Files**:
- `src/components/GameHUD.tsx`
- `src/components/StartMenu.tsx`
- `src/components/PauseMenu.tsx`
- Update `src/App.tsx`

**Tasks**:
- HUD: Speed, distance, current biome + run type ("Downhill" / "Transition"), momentum.
- Clear visual distinction between downhill action and transition segments.
- Start / Pause menus.
- Graphics quality settings.

**Verification**:
- HUD clearly shows when you're in a transition segment.
- Start button works.
- No flickering.

---

## GOAL 5: Performance, Testing & Polish

**Tasks**:
1. Optimize for many dynamic floating objects + varied biome assets.
2. Expand visual regression tests to cover new movement and transition segments.
3. Add performance warnings for complex biome runs.
4. Ensure 60 FPS on both downhill and transition segments.

**Final Verification Checklist**:
- [ ] `npm test` + visual regression pass
- [ ] Manual QA: spawn position, player movement, floating objects, biome variety, transition segments, no raft in downhill runs
- [ ] Build succeeds
- [ ] Memory < 300 MB
- [ ] All AGENTS.md rules followed

---

## FINAL INSTRUCTIONS FOR THE AI (Kimi / Claude / Grok)

When generating code:
- Always output **complete, ready-to-paste** file contents.
- Include JSDoc / TypeScript types.
- Add performance comments (`// PERF: ...`).
- At the end of each goal, provide a short "How to test this goal" section.
- Suggest the exact Git commit message.

**Start with Goal 0** (Fix Live Build Issues) unless the user specifies otherwise.

---

**End of Prompt** — Let's fix the live build first, then build the fast, varied, skill-focused downhill runs! 🚀

(You can re-update this file anytime by telling me what to change or add.)