/**
 * swe.cpp — linearised shallow-water solver + WASM heap grid helpers.
 *
 * The grid is a *visual* system: WaterForceSystem steps a player-centred field
 * and uploads it as a DataTexture that FlowingWater displaces by. Grid size and
 * step rate are budgeted per quality preset in src/systems/sweQuality.ts, so this
 * solver must stay size-agnostic — never assume the 48x32 baseline.
 */

#include "watershed_native.h"

#include <cmath>
#include <cstdlib>
#include <algorithm>

// ---------------------------------------------------------------------------
// Shallow Water Equations (SWE) — one time step
//
//    Solves on a staggered Cartesian grid using forward differences:
//      ∂h/∂t = −H · (∂u/∂x + ∂w/∂z)
//      ∂u/∂t = −g · ∂h/∂x
//      ∂w/∂t = −g · ∂h/∂z
//
//    Grid layout: row-major, index = z * width + x
//      h[i]  — water height perturbation (m)
//      u[i]  — X-velocity component (m/s)
//      w[i]  — Z-velocity component (m/s)
//
//    All three arrays live in WASM linear memory; JS passes byte-offset
//    pointers obtained from allocateGrid().
//
//    @param hPtr   Heap pointer (byte offset) for height field
//    @param uPtr   Heap pointer (byte offset) for X-velocity field
//    @param wPtr   Heap pointer (byte offset) for Z-velocity field
//    @param width  Grid columns
//    @param height Grid rows
//    @param dt     Time step (s)  — internally clamped to CFL limit
//    @param g      Gravity (m/s²)
//    @param dx     Cell size (m)
//    @param H      Mean resting water depth (m) for linearisation
// ---------------------------------------------------------------------------
void stepShallowWater(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr,
                      int width, int height,
                      float dt, float g, float dx, float H) {
    if (width <= 0 || height <= 0 || dx <= 0.f || H <= 0.f) return;
    if (hPtr == 0 || uPtr == 0 || wPtr == 0) return;

    float* h = reinterpret_cast<float*>(hPtr);
    float* u = reinterpret_cast<float*>(uPtr);
    float* w = reinterpret_cast<float*>(wPtr);

    // Enforce CFL stability: dt ≤ dx / (c · √2),  c = √(g·H)
    const float waveSpeed = std::sqrt(g * H);
    const float cflMax    = dx / (waveSpeed * 1.5f);
    const float safeDt    = std::min(dt, cflMax);

    // --- Step 1: update velocities from pressure gradients ---
    for (int z = 0; z < height; ++z) {
        for (int x = 0; x < width; ++x) {
            const int idx = z * width + x;

            const float dhdx = (x < width  - 1) ? (h[idx + 1]     - h[idx]) / dx : 0.f;
            const float dhdz = (z < height - 1) ? (h[idx + width] - h[idx]) / dx : 0.f;

            u[idx] -= g * safeDt * dhdx;
            w[idx] -= g * safeDt * dhdz;
        }
    }

    // --- Step 2: update heights from velocity divergence ---
    for (int z = 0; z < height; ++z) {
        for (int x = 0; x < width; ++x) {
            const int idx = z * width + x;

            const float dudx = (x > 0) ? (u[idx] - u[idx - 1])     / dx : 0.f;
            const float dwdz = (z > 0) ? (w[idx] - w[idx - width])  / dx : 0.f;

            h[idx] -= H * safeDt * (dudx + dwdz);
        }
    }

    // --- Step 3: light velocity damping to prevent divergence ---
    const float damp = 1.f - safeDt * DAMPING_COEFF;
    const int N = width * height;
    for (int i = 0; i < N; ++i) {
        u[i] *= damp;
        w[i] *= damp;
    }
}

// ---------------------------------------------------------------------------
// Grid memory helpers
//    Allocate / free Float32 arrays in WASM heap, addressable from JS via
//    Float32Array(module.HEAPF32.buffer, ptr, count).
// ---------------------------------------------------------------------------

uintptr_t allocateGrid(int count) {
    if (count <= 0) return 0;
    void* ptr = std::calloc(static_cast<std::size_t>(count), sizeof(float));
    return reinterpret_cast<uintptr_t>(ptr);
}

void freeGrid(uintptr_t ptr) {
    std::free(reinterpret_cast<void*>(ptr));
}
