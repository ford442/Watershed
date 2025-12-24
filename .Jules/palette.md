## 2025-12-12 - Controls Overlay & Pointer Lock
**Learning:** Users in pointer-lock games (FPS style) lack visual cues for controls before clicking. A "diegetic" or clean overlay is critical for onboarding and accessibility.
**Action:** Always include a "Click to Start" overlay with key bindings for pointer-lock experiences to bridge the gap between UI and gameplay.

## 2025-01-15 - Asset Loading Feedback
**Learning:** In "photorealistic" WebGL experiences, texture loading can cause a jarring "blank screen" experience before the interactive UI appears. A thematic loading screen is essential for perceived performance and setting the tone.
**Action:** Use `useProgress` from `@react-three/drei` to implement a custom loading overlay that blocks interaction until assets are ready, preventing users from engaging with an incomplete scene.

## 2025-12-14 - WebGL Loader Accessibility
**Learning:** WebGL loading screens are often implemented as simple divs, making them invisible to screen readers.
**Action:** Always wrap visual progress bars in `role="progressbar"` with `aria-valuenow` attributes to ensure screen reader users aren't left in silence during load times.

## 2025-05-22 - Accessible Pointer Lock Trigger
**Learning:** Pointer lock requests require a user gesture. Using a semantic `<button>` instead of a generic clickable element ensures this gesture is accessible to keyboard users and screen readers, while maintaining the "click anywhere" fallback via overlay layering.
**Action:** Use an explicit "Start" button for pointer-lock overlays, ensuring it has `pointer-events: auto` while the overlay remains `pointer-events: none` to allow pass-through clicks.

## 2025-01-28 - Crosshair & Accessibility
**Learning:** First-person experiences using pointer lock can cause motion sickness or disorientation without a visual anchor (reticle/crosshair).
**Action:** Always include a minimal crosshair when pointer lock is active.

## 2025-01-28 - Semantic Control Overlays
**Learning:** Control overlays often use visual-only cues (like key icons) which are invisible to screen readers.
**Action:** Use `role="list"`/`listitem` and `aria-label` to describe control mappings semantically, while hiding purely decorative elements with `aria-hidden="true"`.

## 2025-05-23 - Keyboard Accessible Controls
**Learning:** Non-standard control schemes (like "Right Click to Move") can completely block keyboard-only users.
**Action:** Always map primary actions to standard keyboard inputs (Arrows/Space) in addition to mouse controls, and document them in the UI.

## 2025-02-18 - Reduced Motion & Keyboard Entry
**Learning:** Pulsing animations on text can be problematic for users with vestibular disorders. Also, keyboard users expect `Enter` to work on "Start" screens without navigating to a specific button.
**Action:** Always add `@media (prefers-reduced-motion: reduce)` to disable animations, and add a global `keydown` listener for `Enter` on overlay screens.

## 2025-05-24 - Context-Aware Pause UI
**Learning:** In pointer-lock games, the "Start" screen often doubles as the "Pause" screen. Users returning to the menu via ESC can be confused if the prompt still says "START" (implying a restart).
**Action:** Implement state tracking to distinguish between "Start" (first load) and "Resume" (paused), providing clear text and visual cues like "GAME PAUSED".

## 2025-05-25 - React Three Drei Loader Race Condition
**Learning:** The `useProgress` hook from `@react-three/drei` may report `active: false` initially before assets are queued, causing a flicker where "loading" UI logic might fail.
**Action:** When gating UI based on loading state, check both `active` and `progress < 100` (e.g., `isLoading = active || progress < 100`) to ensure the UI remains in a loading state until completion.
## 2025-05-26 - Explicit Restart in Runner Games
**Learning:** In linear "runner" games where stopping/failing is common but doesn't trigger a hard "Game Over" screen, users can feel soft-locked. A manual "Restart" button in the pause menu provides a necessary escape hatch.
**Action:** Add a "Restart" or "Reset" button to the pause menu for linear or survival games to allow quick retries without browser refresh.

## 2025-06-03 - Smooth UI Transitions & Pointer Events
**Learning:** Conditional rendering (unmounting) prevents CSS transitions on UI elements, making pause menus feel abrupt. Also, `pointer-events: none` on overlays can accidentally block clicks on child buttons if not explicitly reset to `auto`.
**Action:** Use CSS classes (`.visible`/`.hidden`) with `opacity` and `visibility` transitions instead of unmounting components. Always verify `pointer-events: auto` on interactive children of non-interactive overlays.
