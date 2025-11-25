# Watershed — Architectural Recommendation

A concise guide for the Watershed project (hyper-realistic water, rigid-body physics, streaming world). This document explains recommended architecture choices and implementation notes for building a high-end WebGPU game while keeping TypeScript/React for UI and workflow.

## Summary

- Problem: The original React website stack struggles to meet performance and simulation requirements for hyper-realistic water, high-quality physics, and a streaming world.
- Recommendation: Use a hybrid architecture — keep React for UI and high-level state, but move heavy simulation (physics, water) to Wasm/WebGPU and dedicated systems.

## High-level Recommendation

Stay with TypeScript + React for structure and tooling, but "escape" the main thread for physics and run water on the GPU. Architect the project as a game loop (useFrame-like updates and refs), not a React UI loop.

Key points:
- Keep React for menus, UI, and orchestration.
- Run rigid-body physics off the main thread (Web Worker + Rapier in Wasm).
- Implement water simulation as GPU compute shaders (WGSL/WebGPU) and drive surface deformation with flow/height maps.
- Manage streaming world with a treadmill/chunk system and object pooling — avoid allocating new meshes during active gameplay.

## Stack Options (comparative breakdown)

1) The "Hybrid" Stack (Recommended)
- Core: React Three Fiber (R3F) + Three.js with WebGPU renderer
- Physics: Rapier (via @react-three/rapier) or another Wasm-based physics engine
- Water: Custom WebGPU compute shaders (WGSL) — heightmap/flowmap + vertex displacement

Why: You need custom GPU shaders for realistic water and Wasm physics for performance. This keeps the React ecosystem and fast iteration while offloading heavy work.

Pros:
- Retains React tooling and hot-reload workflow
- Can run physics in Wasm for better perf

Cons:
- Requires strict game-loop architecture (useFrame, refs)
- Must avoid React re-renders every frame


2) The "Batteries Included" Stack (Babylon.js)
- Core: Babylon.js
- Physics: Havok (Wasm/native support)

Why: Babylon.js offers strong built-in optimizations for large scenes, streaming assets, and has good tooling (Inspector).

Pros:
- Better out-of-the-box handling of large/streamed scenes
- Good tooling and stability for larger projects

Cons:
- Less idiomatic React integration; often more imperative code


3) The "Native Speed" Stack (Rust / C++)
- Core: Bevy (Rust) or a custom wgpu engine
- Physics: Rapier native or other native physics

Why: If you need the absolute maximum performance and low-level control (no GC), native engines are unmatched.

Pros:
- Maximum raw performance and determinism
- No JS GC pauses

Cons:
- Much slower iteration and toolchain differences
- Building engine-level systems and UI is more work


## Architectural Blueprint for Watershed

If you keep the TS/React approach, here is a focused blueprint to reach high realism while keeping development velocity.

1. Off-main-thread physics
- Run raft/player physics inside a Web Worker using Rapier compiled to Wasm.
- Communicate a minimal, compact state between the worker and main thread (positions, orientations, collisions) to avoid main-thread stalls.

2. Water as a compute shader
- Use WebGPU compute shaders (WGSL) to update a flowmap/heightmap texture each frame.
- Render water with vertex displacement and normal reconstruction from the heightmap.
- Use flow maps to apply directional forces to nearby rigid bodies (e.g., drag the raft downstream).

3. Terrain streaming (the "treadmill")
- Stream world chunks in a treadmill fashion: load upcoming chunks ahead of the player and recycle/unload chunks behind them.
- Use React for chunk-level orchestration: load/unload, request assets, and manage high-level state.
- In the renderer, reuse mesh instances (object pooling) and teleport them as chunks move through the stream. Avoid calling new Mesh() during gameplay.

## Decision Matrix

Feature | React Three Fiber (R3F) | Babylon.js | Rust (Bevy / wgpu)
---|---:|---:|---:
Realistic Water | Hard (requires custom WGSL) | Medium (node materials available) | Hard (requires WGSL/native shaders)
Physics Speed | Fast (Wasm Rapier) | Fast (Wasm Havok) | Fastest (native)
Dev Speed | Fastest (hot reload, JS ecosys.) | Fast | Slow (compile times)
Streaming | Manual (you build chunking) | Good (built-in streaming tools) | Manual

## Verdict

Stick with React Three Fiber if you want to finish the game in a reasonable timeframe. The ecosystem is strong in 2025 and, combined with Wasm physics and WebGPU compute shaders for water, gives a practical balance between performance and developer productivity.

## Next steps / Implementation checklist

- [ ] Prototype a WebGPU compute shader that updates a small heightmap (flowmap + normal reconstruction).
- [ ] Move a minimal Rapier physics example into a Web Worker and verify round-trip state updates.
- [ ] Implement a simple treadmill/chunk streaming prototype and object pooling for static obstacles.
- [ ] Integrate water flow forces to influence a rigid-body raft.

## Notes & References

- The water simulation approach suggested here is focused on surface effects: heightmap / flowmap + vertex displacement and not a full Navier–Stokes solver.
- Keep GPU and Wasm workloads minimal and compact for lower latency between subsystems.


(Original content condensed and reformatted for readability.)
