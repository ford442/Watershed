/**
 * swe.cpp — linearised shallow-water solver + WASM heap grid helpers.
 *
 * The grid is a *visual* system: WaterForceSystem steps a player-centred field
 * and uploads it as a DataTexture that FlowingWater displaces by. Grid size and
 * step rate are budgeted per quality preset in src/systems/sweQuality.ts, so this
 * solver must stay size-agnostic — never assume the 48x32 baseline.
 *
 * Inner loops (pressure gradient, divergence, damping) use 4-wide SIMD when
 * available (wasm_simd128 / SSE2 / NEON). Boundary cells and N%4 tails stay
 * scalar so the stencil matches the original nested loops.
 */

#include "swe.h"
#include "simdf32.h"

#include <cmath>
#include <cstdlib>
#include <algorithm>

namespace {

float cflSafeDt(float dt, float g, float dx, float H) {
    const float waveSpeed = std::sqrt(g * H);
    const float cflMax    = dx / (waveSpeed * 1.5f);
    return std::min(dt, cflMax);
}

void dampVelocities(float* u, float* w, int N, float damp) {
    const f32x4 vdamp = f32x4_splat(damp);
    int i = 0;
    for (; i + 4 <= N; i += 4) {
        f32x4_store(&u[i], f32x4_mul(f32x4_load(&u[i]), vdamp));
        f32x4_store(&w[i], f32x4_mul(f32x4_load(&w[i]), vdamp));
    }
    for (; i < N; ++i) {
        u[i] *= damp;
        w[i] *= damp;
    }
}

}  // namespace

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

    // Enforce CFL stability: dt ≤ dx / (c · 1.5),  c = √(g·H)
    const float safeDt = cflSafeDt(dt, g, dx, H);
    const float gDt = g * safeDt;
    const float hDt = H * safeDt;
    const f32x4 vdx = f32x4_splat(dx);
    const f32x4 vgDt = f32x4_splat(gDt);
    const f32x4 vhDt = f32x4_splat(hDt);
    const f32x4 vzero = f32x4_splat(0.f);

    // --- Step 1: update velocities from pressure gradients ---
    // Last column has dhdx = 0; SIMD covers x in [0, width-2] in groups of 4.
    for (int z = 0; z < height; ++z) {
        const bool lastRow = (z == height - 1);
        int x = 0;
        const int simdLimit = width - 1;
        for (; x + 4 <= simdLimit; x += 4) {
            const int idx = z * width + x;
            const f32x4 hHere = f32x4_load(&h[idx]);
            const f32x4 dhdx = f32x4_div(f32x4_sub(f32x4_load(&h[idx + 1]), hHere), vdx);
            const f32x4 dhdz = lastRow
                ? vzero
                : f32x4_div(f32x4_sub(f32x4_load(&h[idx + width]), hHere), vdx);
            f32x4_store(&u[idx], f32x4_sub(f32x4_load(&u[idx]), f32x4_mul(vgDt, dhdx)));
            f32x4_store(&w[idx], f32x4_sub(f32x4_load(&w[idx]), f32x4_mul(vgDt, dhdz)));
        }
        for (; x < width; ++x) {
            const int idx = z * width + x;
            const float dhdx = (x < width  - 1) ? (h[idx + 1]     - h[idx]) / dx : 0.f;
            const float dhdz = (z < height - 1) ? (h[idx + width] - h[idx]) / dx : 0.f;
            u[idx] -= gDt * dhdx;
            w[idx] -= gDt * dhdz;
        }
    }

    // --- Step 2: update heights from velocity divergence ---
    // First column has dudx = 0; SIMD covers x in [1, width) in groups of 4.
    for (int z = 0; z < height; ++z) {
        const bool firstRow = (z == 0);
        int x = 0;
        {
            const int idx = z * width;
            const float dudx = 0.f;
            const float dwdz = firstRow ? 0.f : (w[idx] - w[idx - width]) / dx;
            h[idx] -= hDt * (dudx + dwdz);
            x = 1;
        }
        for (; x + 4 <= width; x += 4) {
            const int idx = z * width + x;
            const f32x4 dudx = f32x4_div(
                f32x4_sub(f32x4_load(&u[idx]), f32x4_load(&u[idx - 1])), vdx);
            const f32x4 dwdz = firstRow
                ? vzero
                : f32x4_div(f32x4_sub(f32x4_load(&w[idx]), f32x4_load(&w[idx - width])), vdx);
            f32x4_store(&h[idx], f32x4_sub(f32x4_load(&h[idx]),
                f32x4_mul(vhDt, f32x4_add(dudx, dwdz))));
        }
        for (; x < width; ++x) {
            const int idx = z * width + x;
            const float dudx = (x > 0) ? (u[idx] - u[idx - 1])     / dx : 0.f;
            const float dwdz = (z > 0) ? (w[idx] - w[idx - width]) / dx : 0.f;
            h[idx] -= hDt * (dudx + dwdz);
        }
    }

    // --- Step 3: light velocity damping to prevent divergence ---
    const float damp = 1.f - safeDt * DAMPING_COEFF;
    dampVelocities(u, w, width * height, damp);
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
