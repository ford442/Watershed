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
