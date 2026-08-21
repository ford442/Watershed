/**
 * swe.cpp — conservative shallow-water solver + WASM heap grid helpers.
 *
 * The grid is a *visual* system: WaterForceSystem steps a player-centred field
 * and uploads it as a DataTexture that FlowingWater displaces by. Grid size and
 * step rate are budgeted per quality preset in src/systems/water/sweQuality.ts,
 * so this solver must stay size-agnostic — never assume the 48x32 baseline.
 *
 * Scheme (replaces the pre-#374 linearised stepper):
 *
 *   ∂h/∂t  + ∂(hu)/∂x + ∂(hw)/∂z = 0
 *   ∂(hu)/∂t + ∂(hu² + ½gh²)/∂x + ∂(huw)/∂z = −g h ∂b/∂x
 *   ∂(hw)/∂t + ∂(huw)/∂x + ∂(hw² + ½gh²)/∂z = −g h ∂b/∂z
 *
 * Finite volume, Rusanov (local Lax-Friedrichs) interface flux, with Audusse
 * hydrostatic reconstruction so that still water over an arbitrary bed stays
 * still (well-balanced) and dry cells stay dry. Boundaries are transmissive:
 * ghost states mirror the interior cell, so waves leave the player-centred
 * patch instead of ringing inside it.
 *
 * Deliberately scalar: the flux stencil is branchy (dry states, per-interface
 * reconstruction) and does not vectorise the way the old three-line linear
 * stencil did. simdf32.h is still used by forces.cpp / chores.cpp — SIMD is
 * claimed only where it is actually applied (#372 SIMD honesty).
 */

#include "swe.h"

#include <cmath>
#include <cstdlib>
#include <algorithm>
#include <vector>

namespace {

struct Cell {
    float h = 0.f;   // depth (m)
    float hu = 0.f;  // x momentum (m²/s)
    float hw = 0.f;  // z momentum (m²/s)
};

/** Desingularised velocity: zero in (near-)dry cells. */
inline float velocity(float momentum, float depth) noexcept {
    return depth > SWE_DRY_DEPTH ? momentum / depth : 0.f;
}

/** Rusanov flux in x for a reconstructed interface pair. */
inline void fluxX(float hL, float huL, float hwL,
                  float hR, float huR, float hwR,
                  float g, Cell& out) noexcept {
    const float uL = velocity(huL, hL);
    const float uR = velocity(huR, hR);
    const float cL = std::sqrt(g * std::max(hL, 0.f));
    const float cR = std::sqrt(g * std::max(hR, 0.f));
    const float a  = std::max(std::abs(uL) + cL, std::abs(uR) + cR);

    const float fhL  = huL;
    const float fhR  = huR;
    const float fhuL = huL * uL + 0.5f * g * hL * hL;
    const float fhuR = huR * uR + 0.5f * g * hR * hR;
    const float fhwL = hwL * uL;
    const float fhwR = hwR * uR;

    out.h  = 0.5f * (fhL  + fhR)  - 0.5f * a * (hR  - hL);
    out.hu = 0.5f * (fhuL + fhuR) - 0.5f * a * (huR - huL);
    out.hw = 0.5f * (fhwL + fhwR) - 0.5f * a * (hwR - hwL);
}

/** Rusanov flux in z for a reconstructed interface pair. */
inline void fluxZ(float hL, float huL, float hwL,
                  float hR, float huR, float hwR,
                  float g, Cell& out) noexcept {
    const float wL = velocity(hwL, hL);
    const float wR = velocity(hwR, hR);
    const float cL = std::sqrt(g * std::max(hL, 0.f));
    const float cR = std::sqrt(g * std::max(hR, 0.f));
    const float a  = std::max(std::abs(wL) + cL, std::abs(wR) + cR);

    const float fhL  = hwL;
    const float fhR  = hwR;
    const float fhuL = huL * wL;
    const float fhuR = huR * wR;
    const float fhwL = hwL * wL + 0.5f * g * hL * hL;
    const float fhwR = hwR * wR + 0.5f * g * hR * hR;

    out.h  = 0.5f * (fhL  + fhR)  - 0.5f * a * (hR  - hL);
    out.hu = 0.5f * (fhuL + fhuR) - 0.5f * a * (huR - huL);
    out.hw = 0.5f * (fhwL + fhwR) - 0.5f * a * (hwR - hwL);
}

/** Largest wave speed on the grid, used for the CFL substep count. */
float maxWaveSpeed(const float* h, const float* u, const float* w,
                   int n, float g, float floorDepth) noexcept {
    float a = std::sqrt(g * std::max(floorDepth, SWE_DRY_DEPTH));
    for (int i = 0; i < n; ++i) {
        const float c = std::sqrt(g * std::max(h[i], 0.f));
        const float s = std::max(std::abs(u[i]), std::abs(w[i])) + c;
        if (s > a) a = s;
    }
    return a;
}

/**
 * One explicit FV update of `dt` seconds. Scratch buffers are supplied by the
 * caller so the per-frame substep loop allocates nothing.
 */
void substep(float* h, float* u, float* w, const float* b,
             int width, int height, float dt, float g, float dx,
             std::vector<Cell>& state,
             std::vector<Cell>& fx,
             std::vector<Cell>& fz,
             std::vector<float>& srcX,
             std::vector<float>& srcZ) {
    const int n = width * height;

    for (int i = 0; i < n; ++i) {
        const float depth = std::max(h[i], 0.f);
        const bool wet = depth > SWE_DRY_DEPTH;
        state[i].h  = depth;
        state[i].hu = wet ? depth * u[i] : 0.f;
        state[i].hw = wet ? depth * w[i] : 0.f;
    }

    const float bedAt = 0.f;
    auto bed = [&](int i) noexcept { return b ? b[i] : bedAt; };

    // --- x interfaces: fx[idx] is the flux at the face between idx and idx+1.
    // The last column's face is the transmissive boundary (ghost == interior).
    for (int z = 0; z < height; ++z) {
        for (int x = 0; x < width; ++x) {
            const int i = z * width + x;
            const int j = (x < width - 1) ? i + 1 : i;   // ghost mirrors interior
            const float bFace = std::max(bed(i), bed(j));
            const float hLs = std::max(0.f, state[i].h + bed(i) - bFace);
            const float hRs = std::max(0.f, state[j].h + bed(j) - bFace);
            const float uL = velocity(state[i].hu, state[i].h);
            const float uR = velocity(state[j].hu, state[j].h);
            const float wL = velocity(state[i].hw, state[i].h);
            const float wR = velocity(state[j].hw, state[j].h);
            fluxX(hLs, hLs * uL, hLs * wL,
                  hRs, hRs * uR, hRs * wR, g, fx[i]);
            // Audusse pressure corrections, keyed per (cell, side):
            // index*2+1 is the cell's right/downstream face, index*2+0 its left.
            srcX[i * 2 + 1] = 0.5f * g * (state[i].h * state[i].h - hLs * hLs);
            if (j != i) {
                srcX[j * 2 + 0] = 0.5f * g * (state[j].h * state[j].h - hRs * hRs);
            }
        }
    }

    // --- z interfaces: fz[idx] is the flux between idx and idx+width.
    for (int z = 0; z < height; ++z) {
        for (int x = 0; x < width; ++x) {
            const int i = z * width + x;
            const int j = (z < height - 1) ? i + width : i;
            const float bFace = std::max(bed(i), bed(j));
            const float hLs = std::max(0.f, state[i].h + bed(i) - bFace);
            const float hRs = std::max(0.f, state[j].h + bed(j) - bFace);
            const float uL = velocity(state[i].hu, state[i].h);
            const float uR = velocity(state[j].hu, state[j].h);
            const float wL = velocity(state[i].hw, state[i].h);
            const float wR = velocity(state[j].hw, state[j].h);
            fluxZ(hLs, hLs * uL, hLs * wL,
                  hRs, hRs * uR, hRs * wR, g, fz[i]);
            srcZ[i * 2 + 1] = 0.5f * g * (state[i].h * state[i].h - hLs * hLs);
            if (j != i) {
                srcZ[j * 2 + 0] = 0.5f * g * (state[j].h * state[j].h - hRs * hRs);
            }
        }
    }

    const float lambda = dt / dx;
    const float damp = std::max(0.f, 1.f - dt * DAMPING_COEFF);

    // Transmissive outer boundary: the missing face uses a ghost cell equal to
    // the interior cell, so the Rusanov flux collapses to the cell's own
    // physical flux and waves leave the patch instead of reflecting.
    auto selfFluxX = [&](int i, Cell& out) noexcept {
        const float hi = state[i].h;
        const float ui = velocity(state[i].hu, hi);
        out.h  = state[i].hu;
        out.hu = state[i].hu * ui + 0.5f * g * hi * hi;
        out.hw = state[i].hw * ui;
    };
    auto selfFluxZ = [&](int i, Cell& out) noexcept {
        const float hi = state[i].h;
        const float wi = velocity(state[i].hw, hi);
        out.h  = state[i].hw;
        out.hu = state[i].hu * wi;
        out.hw = state[i].hw * wi + 0.5f * g * hi * hi;
    };

    Cell ghostX;
    Cell ghostZ;

    for (int z = 0; z < height; ++z) {
        for (int x = 0; x < width; ++x) {
            const int i = z * width + x;
            if (x == 0) selfFluxX(i, ghostX);
            if (z == 0) selfFluxZ(i, ghostZ);
            const Cell& right = fx[i];
            const Cell& left  = (x > 0) ? fx[i - 1] : ghostX;
            const Cell& down  = fz[i];
            const Cell& up    = (z > 0) ? fz[i - width] : ghostZ;

            // Audusse: the pressure correction rides along with each face flux.
            const float fRightHu = right.hu + srcX[i * 2 + 1];
            const float fLeftHu  = left.hu  + srcX[i * 2 + 0];
            const float fDownHw  = down.hw  + srcZ[i * 2 + 1];
            const float fUpHw    = up.hw    + srcZ[i * 2 + 0];

            const float dh  = (right.h - left.h) + (down.h - up.h);
            const float dhu = (fRightHu - fLeftHu) + (down.hu - up.hu);
            const float dhw = (right.hw - left.hw) + (fDownHw - fUpHw);

            const float nh  = state[i].h  - lambda * dh;
            const float nhu = state[i].hu - lambda * dhu;
            const float nhw = state[i].hw - lambda * dhw;

            if (nh <= SWE_DRY_DEPTH) {
                // Wetting/drying: a dry cell keeps no depth debt and no momentum.
                h[i] = std::max(nh, 0.f);
                u[i] = 0.f;
                w[i] = 0.f;
                continue;
            }

            h[i] = nh;
            u[i] = (nhu / nh) * damp;
            w[i] = (nhw / nh) * damp;
        }
    }
}

}  // namespace

// ---------------------------------------------------------------------------
// Public entry points
//
//    Grid layout: row-major, index = z * width + x
//      h[i]  — water depth above the bed (m, >= 0)
//      u[i]  — X-velocity component (m/s)
//      w[i]  — Z-velocity component (m/s)
//      b[i]  — bed elevation (m); optional, 0 pointer means a flat bed
//
//    All arrays live in WASM linear memory; JS passes byte-offset pointers
//    obtained from allocateGrid().
// ---------------------------------------------------------------------------
void stepShallowWaterBed(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr,
                         uintptr_t bPtr,
                         int width, int height,
                         float dt, float g, float dx, float H) {
    if (width <= 0 || height <= 0 || dx <= 0.f || g <= 0.f) return;
    if (hPtr == 0 || uPtr == 0 || wPtr == 0) return;
    if (!(dt > 0.f)) return;

    float* h = reinterpret_cast<float*>(hPtr);
    float* u = reinterpret_cast<float*>(uPtr);
    float* w = reinterpret_cast<float*>(wPtr);
    const float* b = bPtr ? reinterpret_cast<const float*>(bPtr) : nullptr;

    const int n = width * height;

    // CFL is enforced here, not in JS: pick a substep count from the actual
    // wave speed on the grid, capped so one slow frame cannot stall the tab.
    const float a = maxWaveSpeed(h, u, w, n, g, std::max(H, 0.f));
    const float dtMax = SWE_CFL_NUMBER * dx / a;
    int substeps = 1;
    if (dt > dtMax) {
        substeps = static_cast<int>(std::ceil(dt / dtMax));
        substeps = std::min(substeps, SWE_MAX_SUBSTEPS);
    }
    const float subDt = std::min(dt / static_cast<float>(substeps), dtMax);

    static std::vector<Cell> state;
    static std::vector<Cell> fx;
    static std::vector<Cell> fz;
    static std::vector<float> srcX;
    static std::vector<float> srcZ;
    if (static_cast<int>(state.size()) < n) {
        state.resize(static_cast<std::size_t>(n));
        fx.resize(static_cast<std::size_t>(n));
        fz.resize(static_cast<std::size_t>(n));
        srcX.resize(static_cast<std::size_t>(n) * 2);
        srcZ.resize(static_cast<std::size_t>(n) * 2);
    }
    std::fill(srcX.begin(), srcX.begin() + n * 2, 0.f);
    std::fill(srcZ.begin(), srcZ.begin() + n * 2, 0.f);

    for (int s = 0; s < substeps; ++s) {
        substep(h, u, w, b, width, height, subDt, g, dx,
                state, fx, fz, srcX, srcZ);
    }
}

void stepShallowWater(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr,
                      int width, int height,
                      float dt, float g, float dx, float H) {
    stepShallowWaterBed(hPtr, uPtr, wPtr, 0, width, height, dt, g, dx, H);
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
