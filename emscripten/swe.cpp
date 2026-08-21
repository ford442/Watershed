/**
 * swe.cpp — nonlinear shallow-water solver + WASM heap grid helpers.
 *
 * The grid is a *visual* system: WaterForceSystem steps a player-centred field
 * and uploads it as a DataTexture that FlowingWater displaces by. Grid size and
 * step rate are budgeted per quality preset in src/systems/water/sweQuality.ts,
 * so this solver must stay size-agnostic — never assume the 48x32 baseline.
 *
 * Scheme (replaces the pre-ABI-6 linearised stepper):
 *
 *   Conserved state per cell is (d, d·u, d·w) where d is the total water
 *   column depth. Interface fluxes come from an HLL approximate Riemann solver
 *   on top of an Audusse hydrostatic reconstruction, which is what buys the two
 *   properties the linearised version could not express:
 *
 *     1. Well-balanced — a flat free surface over an arbitrary bed stays
 *        exactly at rest. The bed source term is folded into the reconstructed
 *        interface states rather than added separately, so lake-at-rest is
 *        preserved to round-off instead of generating spurious current.
 *     2. Wetting/drying — d is clamped at zero, so a bank higher than the free
 *        surface is simply a dry cell. This is what makes a slot canyon and a
 *        delta read as different water rather than the same rectangle of waves
 *        with a different palette.
 *
 *   Boundaries are transmissive (ghost = interior). The grid is a moving
 *   player-centred window, so waves must leave it rather than reflect off an
 *   invisible wall four metres from the raft.
 *
 * Field conventions are documented in swe.h and are part of the ABI: `h` is a
 * free-surface *perturbation*, not a depth, because FlowingWater displaces
 * vertices by it directly.
 */

#include "swe.h"
#include "simdf32.h"

#include <cmath>
#include <cstdlib>
#include <algorithm>
#include <vector>

// Depth below which a cell counts as dry. Small enough that it never shows up
// as visible displacement, large enough to keep q/d well conditioned.
const float SWE_DRY_DEPTH = 1e-4f;

namespace {

/**
 * Courant number for the first-order unsplit 2D update. Lower than the 1D
 * stability limit because x and z fluxes are applied from the same state in one
 * pass rather than in sequential sweeps.
 */
constexpr float kCflNumber = 0.4f;

/** Flux triple across one interface: mass, normal momentum, transverse momentum. */
struct Flux {
    float mass  = 0.f;
    float mom   = 0.f;
    float trans = 0.f;
};

/** Cell state as seen by the Riemann solver, already rotated into face-normal axes. */
struct FaceState {
    float d  = 0.f;  // depth
    float qn = 0.f;  // normal momentum   (d * normal velocity)
    float qt = 0.f;  // transverse momentum
};

inline float normalVelocity(const FaceState& s) {
    return (s.d > SWE_DRY_DEPTH) ? s.qn / s.d : 0.f;
}

inline Flux physicalFlux(const FaceState& s, float g) {
    const float un = normalVelocity(s);
    return Flux{ s.qn, s.qn * un + 0.5f * g * s.d * s.d, s.qt * un };
}

/**
 * HLL approximate Riemann solver.
 *
 * Wave speeds use the dry-front estimates (Toro) when one side is dry, so a
 * wet cell advancing onto dry bed gets the correct 2c front speed instead of a
 * zero-speed wall.
 */
Flux hllFlux(const FaceState& L, const FaceState& R, float g) {
    const bool dryL = L.d <= SWE_DRY_DEPTH;
    const bool dryR = R.d <= SWE_DRY_DEPTH;
    if (dryL && dryR) return Flux{};

    const float unL = normalVelocity(L);
    const float unR = normalVelocity(R);
    const float cL  = std::sqrt(g * std::max(L.d, 0.f));
    const float cR  = std::sqrt(g * std::max(R.d, 0.f));

    float sL, sR;
    if (dryL) {
        // Dry bed on the left: the front runs left at unR - 2cR.
        sL = unR - 2.f * cR;
        sR = unR + cR;
    } else if (dryR) {
        sL = unL - cL;
        sR = unL + 2.f * cL;
    } else {
        sL = std::min(unL - cL, unR - cR);
        sR = std::max(unL + cL, unR + cR);
    }

    const Flux FL = physicalFlux(L, g);
    const Flux FR = physicalFlux(R, g);

    if (sL >= 0.f) return FL;
    if (sR <= 0.f) return FR;

    const float inv = 1.f / (sR - sL);
    return Flux{
        (sR * FL.mass  - sL * FR.mass  + sL * sR * (R.d  - L.d )) * inv,
        (sR * FL.mom   - sL * FR.mom   + sL * sR * (R.qn - L.qn)) * inv,
        (sR * FL.trans - sL * FR.trans + sL * sR * (R.qt - L.qt)) * inv,
    };
}

/**
 * Audusse hydrostatic reconstruction across one interface.
 *
 * Returns the HLL flux together with the two well-balancing momentum
 * corrections: `momL` is what the left cell subtracts at this face, `momR` is
 * what the right cell adds. Using a single shared momentum would reintroduce
 * the bed source term the reconstruction exists to cancel.
 */
struct InterfaceFlux {
    float mass  = 0.f;
    float momL  = 0.f;
    float momR  = 0.f;
    float trans = 0.f;
};

InterfaceFlux reconstructedFlux(float dL, float qnL, float qtL, float zbL,
                                float dR, float qnR, float qtR, float zbR,
                                float g) {
    // Free-surface elevations. Only differences matter, so the constant offset
    // between the perturbation datum and the bed datum cancels here.
    const float surfaceL = dL + zbL;
    const float surfaceR = dR + zbR;
    const float zbFace   = std::max(zbL, zbR);

    const float dLs = std::max(0.f, surfaceL - zbFace);
    const float dRs = std::max(0.f, surfaceR - zbFace);

    const float unL = (dL > SWE_DRY_DEPTH) ? qnL / dL : 0.f;
    const float utL = (dL > SWE_DRY_DEPTH) ? qtL / dL : 0.f;
    const float unR = (dR > SWE_DRY_DEPTH) ? qnR / dR : 0.f;
    const float utR = (dR > SWE_DRY_DEPTH) ? qtR / dR : 0.f;

    const FaceState starL{ dLs, dLs * unL, dLs * utL };
    const FaceState starR{ dRs, dRs * unR, dRs * utR };

    const Flux f = hllFlux(starL, starR, g);

    return InterfaceFlux{
        f.mass,
        f.mom + 0.5f * g * (dL * dL - dLs * dLs),
        f.mom + 0.5f * g * (dR * dR - dRs * dRs),
        f.trans,
    };
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

/**
 * Scratch buffers, reused across steps so a 60 Hz solver does not allocate.
 * thread_local rather than plain static because the optional `--threads` build
 * links pthreads; the solver itself is still driven from one caller.
 */
struct Scratch {
    std::vector<float> d, qx, qz;
    std::vector<float> accD, accQx, accQz;

    void resize(std::size_t n) {
        if (d.size() == n) return;
        d.assign(n, 0.f);
        qx.assign(n, 0.f);
        qz.assign(n, 0.f);
        accD.assign(n, 0.f);
        accQx.assign(n, 0.f);
        accQz.assign(n, 0.f);
    }
};

thread_local Scratch g_scratch;

}  // namespace

// ---------------------------------------------------------------------------
// Shallow Water Equations (SWE) — one time step
//
//    ∂d/∂t     + ∂(d u)/∂x       + ∂(d w)/∂z       = 0
//    ∂(d u)/∂t + ∂(d u² + ½gd²)/∂x + ∂(d u w)/∂z   = −g d ∂zb/∂x
//    ∂(d w)/∂t + ∂(d u w)/∂x     + ∂(d w² + ½gd²)/∂z = −g d ∂zb/∂z
//
//    Grid layout: row-major, index = z * width + x
// ---------------------------------------------------------------------------
void stepShallowWater(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                      int width, int height,
                      float dt, float g, float dx, float H) {
    if (width <= 0 || height <= 0 || dx <= 0.f || H <= 0.f) return;
    if (hPtr == 0 || uPtr == 0 || wPtr == 0) return;
    if (dt <= 0.f || g <= 0.f) return;

    float* h = reinterpret_cast<float*>(hPtr);
    float* u = reinterpret_cast<float*>(uPtr);
    float* w = reinterpret_cast<float*>(wPtr);
    const float* b = reinterpret_cast<const float*>(bPtr);  // may be null → flat bed

    const int N = width * height;
    Scratch& s = g_scratch;
    s.resize(static_cast<std::size_t>(N));

    float* d   = s.d.data();
    float* qx  = s.qx.data();
    float* qz  = s.qz.data();
    float* accD  = s.accD.data();
    float* accQx = s.accQx.data();
    float* accQz = s.accQz.data();

    auto bedAt = [b](int i) { return b ? b[i] : 0.f; };

    // --- Lift (η, u, w) into conserved (d, d·u, d·w) ---
    float maxWaveSpeed = 0.f;
    for (int i = 0; i < N; ++i) {
        const float depth = std::max(0.f, H + h[i] - bedAt(i));
        d[i] = depth;
        if (depth <= SWE_DRY_DEPTH) {
            // A dry cell carries no momentum; leaving stale velocity here would
            // let a bank inject flow the moment it re-wets.
            qx[i] = 0.f;
            qz[i] = 0.f;
        } else {
            qx[i] = depth * u[i];
            qz[i] = depth * w[i];
            const float speed = std::sqrt(u[i] * u[i] + w[i] * w[i]) + std::sqrt(g * depth);
            maxWaveSpeed = std::max(maxWaveSpeed, speed);
        }
        accD[i]  = 0.f;
        accQx[i] = 0.f;
        accQz[i] = 0.f;
    }

    // Everything is dry — nothing to advance, but still write back the clamp.
    if (maxWaveSpeed <= 0.f) {
        for (int i = 0; i < N; ++i) {
            h[i] = d[i] + bedAt(i) - H;
            u[i] = 0.f;
            w[i] = 0.f;
        }
        return;
    }

    // Enforce CFL stability: dt ≤ C · dx / max(|v| + √(g d))
    const float safeDt = std::min(dt, kCflNumber * dx / maxWaveSpeed);
    const float dtdx = safeDt / dx;

    // --- X-direction interfaces (normal = x, transverse = z) ---
    // xf indexes the face left of column xf; xf == 0 and xf == width are the
    // transmissive boundaries, where the ghost cell mirrors the interior.
    for (int z = 0; z < height; ++z) {
        const int row = z * width;
        for (int xf = 0; xf <= width; ++xf) {
            const int iL = row + ((xf == 0) ? 0 : xf - 1);
            const int iR = row + ((xf == width) ? width - 1 : xf);

            const InterfaceFlux f = reconstructedFlux(
                d[iL], qx[iL], qz[iL], bedAt(iL),
                d[iR], qx[iR], qz[iR], bedAt(iR),
                g);

            if (xf > 0) {  // real cell on the left of this face
                accD[iL]  -= dtdx * f.mass;
                accQx[iL] -= dtdx * f.momL;
                accQz[iL] -= dtdx * f.trans;
            }
            if (xf < width) {  // real cell on the right of this face
                accD[iR]  += dtdx * f.mass;
                accQx[iR] += dtdx * f.momR;
                accQz[iR] += dtdx * f.trans;
            }
        }
    }

    // --- Z-direction interfaces (normal = z, transverse = x) ---
    for (int x = 0; x < width; ++x) {
        for (int zf = 0; zf <= height; ++zf) {
            const int iL = ((zf == 0) ? 0 : zf - 1) * width + x;
            const int iR = ((zf == height) ? height - 1 : zf) * width + x;

            // Normal is z here, so qz is the normal momentum and qx transverse.
            const InterfaceFlux f = reconstructedFlux(
                d[iL], qz[iL], qx[iL], bedAt(iL),
                d[iR], qz[iR], qx[iR], bedAt(iR),
                g);

            if (zf > 0) {
                accD[iL]  -= dtdx * f.mass;
                accQz[iL] -= dtdx * f.momL;
                accQx[iL] -= dtdx * f.trans;
            }
            if (zf < height) {
                accD[iR]  += dtdx * f.mass;
                accQz[iR] += dtdx * f.momR;
                accQx[iR] += dtdx * f.trans;
            }
        }
    }

    // --- Apply the update and lower back to (η, u, w) ---
    for (int i = 0; i < N; ++i) {
        const float depth = std::max(0.f, d[i] + accD[i]);
        if (depth <= SWE_DRY_DEPTH) {
            // Dry: pin the surface to the bed so η reports "no water here"
            // rather than a negative pit the shader would displace into.
            h[i] = bedAt(i) - H;
            u[i] = 0.f;
            w[i] = 0.f;
            continue;
        }
        const float nqx = qx[i] + accQx[i];
        const float nqz = qz[i] + accQz[i];
        h[i] = depth + bedAt(i) - H;
        u[i] = nqx / depth;
        w[i] = nqz / depth;
    }

    // --- Light velocity damping to prevent long-run divergence ---
    const float damp = 1.f - safeDt * DAMPING_COEFF;
    dampVelocities(u, w, N, damp);
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
