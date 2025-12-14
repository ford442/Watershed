## 2025-12-12 - Controls Overlay & Pointer Lock
**Learning:** Users in pointer-lock games (FPS style) lack visual cues for controls before clicking. A "diegetic" or clean overlay is critical for onboarding and accessibility.
**Action:** Always include a "Click to Start" overlay with key bindings for pointer-lock experiences to bridge the gap between UI and gameplay.

## 2025-01-15 - Asset Loading Feedback
**Learning:** In "photorealistic" WebGL experiences, texture loading can cause a jarring "blank screen" experience before the interactive UI appears. A thematic loading screen is essential for perceived performance and setting the tone.
**Action:** Use `useProgress` from `@react-three/drei` to implement a custom loading overlay that blocks interaction until assets are ready, preventing users from engaging with an incomplete scene.

## 2025-12-14 - WebGL Loader Accessibility
**Learning:** WebGL loading screens are often implemented as simple divs, making them invisible to screen readers.
**Action:** Always wrap visual progress bars in `role="progressbar"` with `aria-valuenow` attributes to ensure screen reader users aren't left in silence during load times.
