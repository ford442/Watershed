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
 *   Boundaries are transmissive (ghost = interior), so a wave reaching the edge
 *   leaves rather than reflecting off an invisible wall four metres from the
 *   raft. stepShallowWaterInflow (ABI 10) swaps the upstream (high-row) ghost
 *   for a characteristic inflow carrying the routed stage from routing.cpp;
 *   the other three edges stay transmissive. That only sheds waves from a FIXED grid: the grid is a player-centred
 *   window that moves, and this solver knows nothing about its origin. The
 *   window is kept world-stable by scrollShallowWater (below), which the caller
 *   runs on every whole-cell origin move before the bed refresh and the step.
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
#include <span>
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

// ---------------------------------------------------------------------------
// 4-wide interface flux (#467)
//
// reconstructedFlux + hllFlux for four faces at once. Every lane evaluates the
// scalar expression above in the same order, and the branches become
// selects: both dry-front speed estimates and all three HLL outcomes are
// computed and the right one picked per lane. f32x4_max / f32x4_min are
// std::max / std::min (simdf32.h), so on the host the vector faces agree with
// the scalar faces bit for bit and the goldens did not move.
// ---------------------------------------------------------------------------

struct InterfaceFlux4 {
    f32x4 mass, momL, momR, trans;
};

struct FluxConsts {
    f32x4 zero, dry, two, g, halfG;
    explicit FluxConsts(float gs)
        : zero(f32x4_splat(0.f)), dry(f32x4_splat(SWE_DRY_DEPTH)), two(f32x4_splat(2.f)),
          g(f32x4_splat(gs)), halfG(f32x4_splat(0.5f * gs)) {}
};

/**
 * `unX` / `utX` are the cell velocities reconstructedFlux derives from the
 * momenta, `(d > dry) ? q / d : 0` — precomputed once per cell in the lift
 * pass (each cell borders two faces per axis), the same division, so the
 * result is unchanged.
 */
inline InterfaceFlux4 reconstructedFlux4(f32x4 dL, f32x4 unL, f32x4 utL, f32x4 zbL,
                                         f32x4 dR, f32x4 unR, f32x4 utR, f32x4 zbR,
                                         const FluxConsts& k) {
    // Hydrostatic reconstruction.
    const f32x4 zbFace = f32x4_max(zbL, zbR);
    const f32x4 dLs = f32x4_max(k.zero, f32x4_sub(f32x4_add(dL, zbL), zbFace));
    const f32x4 dRs = f32x4_max(k.zero, f32x4_sub(f32x4_add(dR, zbR), zbFace));

    // Star states (FaceState{dLs, dLs*unL, dLs*utL}).
    const f32x4 sqnL = f32x4_mul(dLs, unL);
    const f32x4 sqtL = f32x4_mul(dLs, utL);
    const f32x4 sqnR = f32x4_mul(dRs, unR);
    const f32x4 sqtR = f32x4_mul(dRs, utR);

    // HLL on the star states.
    const f32x4 dryL = f32x4_le(dLs, k.dry);
    const f32x4 dryR = f32x4_le(dRs, k.dry);
    const f32x4 vnL = f32x4_select(dryL, k.zero, f32x4_div(sqnL, dLs));
    const f32x4 vnR = f32x4_select(dryR, k.zero, f32x4_div(sqnR, dRs));
    const f32x4 cL = f32x4_sqrt(f32x4_mul(k.g, f32x4_max(dLs, k.zero)));
    const f32x4 cR = f32x4_sqrt(f32x4_mul(k.g, f32x4_max(dRs, k.zero)));

    const f32x4 sLWet = f32x4_min(f32x4_sub(vnL, cL), f32x4_sub(vnR, cR));
    const f32x4 sRWet = f32x4_max(f32x4_add(vnL, cL), f32x4_add(vnR, cR));
    const f32x4 sLDryL = f32x4_sub(vnR, f32x4_mul(k.two, cR));
    const f32x4 sRDryL = f32x4_add(vnR, cR);
    const f32x4 sLDryR = f32x4_sub(vnL, cL);
    const f32x4 sRDryR = f32x4_add(vnL, f32x4_mul(k.two, cL));
    const f32x4 sL = f32x4_select(dryL, sLDryL, f32x4_select(dryR, sLDryR, sLWet));
    const f32x4 sR = f32x4_select(dryL, sRDryL, f32x4_select(dryR, sRDryR, sRWet));

    // physicalFlux: { qn, qn*un + ½g·d·d, qt*un }
    const f32x4 fLm = sqnL;
    const f32x4 fLp = f32x4_add(f32x4_mul(sqnL, vnL), f32x4_mul(f32x4_mul(k.halfG, dLs), dLs));
    const f32x4 fLt = f32x4_mul(sqtL, vnL);
    const f32x4 fRm = sqnR;
    const f32x4 fRp = f32x4_add(f32x4_mul(sqnR, vnR), f32x4_mul(f32x4_mul(k.halfG, dRs), dRs));
    const f32x4 fRt = f32x4_mul(sqtR, vnR);

    // (sR·FL − sL·FR + sL·sR·(R − L)) / (sR − sL)
    const f32x4 inv = f32x4_div(f32x4_splat(1.f), f32x4_sub(sR, sL));
    const f32x4 sLsR = f32x4_mul(sL, sR);
    const auto hll = [&](f32x4 fl, f32x4 fr, f32x4 qr, f32x4 ql) {
        return f32x4_mul(
            f32x4_add(f32x4_sub(f32x4_mul(sR, fl), f32x4_mul(sL, fr)),
                      f32x4_mul(sLsR, f32x4_sub(qr, ql))),
            inv);
    };
    const f32x4 takeL = f32x4_ge(sL, k.zero);
    const f32x4 takeR = f32x4_le(sR, k.zero);
    const f32x4 bothDry = f32x4_and(dryL, dryR);
    const auto pick = [&](f32x4 fl, f32x4 fr, f32x4 mid) {
        return f32x4_select(bothDry, k.zero, f32x4_select(takeL, fl, f32x4_select(takeR, fr, mid)));
    };
    const f32x4 mass = pick(fLm, fRm, hll(fLm, fRm, dRs, dLs));
    const f32x4 mom = pick(fLp, fRp, hll(fLp, fRp, sqnR, sqnL));
    const f32x4 trans = pick(fLt, fRt, hll(fLt, fRt, sqtR, sqtL));

    // Well-balancing momentum corrections: ½g·(d² − d*²) per side.
    return InterfaceFlux4{
        mass,
        f32x4_add(mom, f32x4_mul(k.halfG, f32x4_sub(f32x4_mul(dL, dL), f32x4_mul(dLs, dLs)))),
        f32x4_add(mom, f32x4_mul(k.halfG, f32x4_sub(f32x4_mul(dR, dR), f32x4_mul(dRs, dRs)))),
        trans,
    };
}

/** Fluxes of one row of faces, SoA. Views into FaceRowStorage. */
struct FaceRow {
    float* mass;
    float* momL;
    float* momR;
    float* trans;
};

struct FaceRowStorage {
    std::vector<float> mass, momL, momR, trans;
    void resize(int n) {
        for (auto* v : {&mass, &momL, &momR, &trans}) v->assign(static_cast<std::size_t>(n), 0.f);
    }
    FaceRow row() { return FaceRow{mass.data(), momL.data(), momR.data(), trans.data()}; }
};

/**
 * Reused per-step buffers, so a 60 Hz solver does not allocate (see
 * reserveShallowWaterScratch). thread_local rather than plain static because
 * the optional `--threads` build links pthreads; the solver itself is still
 * driven from one caller.
 *
 * Flux form (#467): every face's flux is computed once, then each cell
 * gathers F[left] − F[right] per axis. Faces are produced a row at a time —
 * x-face xf of a row is the face left of column xf (width + 1 of them), z-face
 * row zf is the faces below row zf (width of them) — so four adjacent faces go
 * through HLL in one f32x4 and no access strides by `width`.
 */
struct Scratch {
    /** Capacity in cells and in columns: the buffers only ever grow (#502). */
    std::size_t cells = 0;
    int columns = 0;
    std::vector<float> d, qx, qz;
    /** Cell velocities (d > dry ? q / d : 0), shared by the four faces of a cell. */
    std::vector<float> vx, vz;
    /** One row of faces each: the current row's x-faces, and the z-faces below / above it. */
    FaceRowStorage xFaces, zFacesA, zFacesB;
    /** The bed when the caller passes none: a flat bed without a per-cell branch. Never written. */
    std::vector<float> zeroBed;
    /** Upstream-edge ghosts, SoA, one per column (z-face axes: qz normal), and their velocities. */
    std::vector<float> ghostD, ghostQz, ghostQx, ghostVz, ghostVx;

    /**
     * Grow to hold a w x h grid. Grow-only, so a session that steps two grids
     * of different sizes (a quality change mid-flight, the WGSL parity bench)
     * does not reallocate on every alternation as the old dimension key did.
     * Every buffer is rewritten over [0, w * h) / [0, w] by each step before it
     * is read, and the step indexes with its own width, so a larger buffer is
     * indistinguishable from an exact one.
     */
    void resize(int w, int h) {
        const std::size_t n = static_cast<std::size_t>(w) * static_cast<std::size_t>(h);
        if (n > cells) {
            cells = n;
            for (auto* v : {&d, &qx, &qz, &vx, &vz, &zeroBed}) v->assign(n, 0.f);
        }
        if (w > columns) {
            columns = w;
            xFaces.resize(w + 1);
            zFacesA.resize(w);
            zFacesB.resize(w);
            for (auto* v : {&ghostD, &ghostQz, &ghostQx, &ghostVz, &ghostVx}) {
                v->assign(static_cast<std::size_t>(w), 0.f);
            }
        }
    }
};

thread_local Scratch g_scratch;

/** Conserved state of a ghost cell, in z-face axes (normal = z). */
struct GhostCell {
    float d  = 0.f;
    float qz = 0.f;
    float qx = 0.f;
};

/**
 * Upstream-edge ghost for the face above the last row (zf == height).
 *
 * Downstream is −Z, so the high-row edge is where the river enters the window.
 * The routed discharge arrives as a stage `edgeEta`; the ghost is built from
 * characteristics so the edge admits that stage without walling off waves
 * leaving the window. With inflow speed v measured INTO the window (−Z):
 *
 *   outside  still water at stage edgeEta, moving in as a simple wave:
 *            v_ext = 2 (c_ext − c_0)   (c_0 = still-water celerity)
 *   R+ = v_ext + 2 c_ext               enters from outside
 *   R− = v_in  − 2 c_in                leaves from the interior cell
 *   ghost:   v = (R+ + R−) / 2,  c = (R+ − R−) / 4
 *
 * Supercritical inflow takes both invariants from outside; supercritical
 * outflow through the edge takes both from inside (transmissive).
 *
 * Everything is expressed against the interior cell's own depth and η, never
 * a recomputed H − b, so edgeEta == 0 over a still interior returns that
 * interior state exactly — the step is then bit-identical to the transmissive
 * stepShallowWater, and lake-at-rest is exactly as well-balanced as it was.
 */
GhostCell upstreamGhost(float dI, float hI, float qzI, float qxI, float edgeEta, float g) {
    const bool wetI = dI > SWE_DRY_DEPTH;
    // H − b for this column is dI − hI (depth = H + η − b).
    const float dStill = std::max(0.f, dI - hI);
    const float dExt = std::max(0.f, dStill + edgeEta);
    if (!wetI && dExt <= SWE_DRY_DEPTH) return GhostCell{ dI, qzI, qxI };  // dry column: transmissive

    const float cExt = std::sqrt(g * dExt);
    const float vExt = 2.f * (cExt - std::sqrt(g * dStill));
    const float cI = std::sqrt(g * std::max(dI, 0.f));
    const float vI = wetI ? -qzI / dI : 0.f;
    const float utI = wetI ? qxI / dI : 0.f;

    if (vI + cI < 0.f) return GhostCell{ dI, qzI, qxI };  // supercritical outflow

    float dG;
    float vG;
    if (vExt >= cExt) {
        dG = dExt;
        vG = vExt;
    } else {
        // Hold R− from the interior and replace only the incoming invariant:
        // with jump ΔR = R+_ext − R+_in the ghost is the interior plus
        //   v = v_in + ΔR/2,   c = c_in + ΔR/4.
        // ΔR == 0 (reference stage over still water) reproduces the interior
        // exactly, whatever the compiler reassociates (-ffast-math WASM build).
        const float dR4 = 0.25f * ((vExt + 2.f * cExt) - (vI + 2.f * cI));
        const float cG = cI + dR4;
        if (cG <= 0.f) return GhostCell{};
        vG = vI + 2.f * dR4;
        dG = dI + dR4 * (2.f * cI + dR4) / g;  // c_G² / g, relative to d_in
    }
    if (dG <= SWE_DRY_DEPTH) return GhostCell{};
    return GhostCell{ dG, -dG * vG, dG * utI };
}

/** Wave speed a ghost contributes to the CFL max: |v| + √(g d). */
inline float ghostWaveSpeed(const GhostCell& c, float g) {
    if (c.d <= SWE_DRY_DEPTH) return 0.f;
    const float v = c.qz / c.d;
    const float t = c.qx / c.d;
    return std::sqrt(v * v + t * t) + std::sqrt(g * c.d);
}

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
namespace {

/** Store one scalar interface flux into the SoA face planes at `at`. */
inline void storeFace(float* mass, float* momL, float* momR, float* trans, int at, const InterfaceFlux& f) {
    mass[at] = f.mass;
    momL[at] = f.momL;
    momR[at] = f.momR;
    trans[at] = f.trans;
}

inline void storeFace4(float* mass, float* momL, float* momR, float* trans, int at, const InterfaceFlux4& f) {
    f32x4_store(&mass[at], f.mass);
    f32x4_store(&momL[at], f.momL);
    f32x4_store(&momR[at], f.momR);
    f32x4_store(&trans[at], f.trans);
}

/**
 * x-faces of one cell row into `out` (width + 1 faces). Face xf sits left of
 * column xf; faces 0 and width are transmissive boundaries (ghost = interior),
 * faces 1..width-1 run four at a time.
 */
void xFaceRow(const float* d, const float* qx, const float* qz, const float* vx, const float* vz,
              const float* b, int width, int row, const FluxConsts& k, float g, const FaceRow& out) {
    storeFace(out.mass, out.momL, out.momR, out.trans, 0,
              reconstructedFlux(d[row], qx[row], qz[row], b[row],
                                d[row], qx[row], qz[row], b[row], g));
    // Interior faces 1..width-1. When the count is not a multiple of four the
    // last group starts at width - 4 and recomputes a few faces instead of
    // dropping to the scalar HLL: same inputs, same values, idempotent store.
    const auto group = [&](int xf) {
        const int iL = row + xf - 1;
        const int iR = row + xf;
        storeFace4(out.mass, out.momL, out.momR, out.trans, xf,
                   reconstructedFlux4(f32x4_load(&d[iL]), f32x4_load(&vx[iL]), f32x4_load(&vz[iL]), f32x4_load(&b[iL]),
                                      f32x4_load(&d[iR]), f32x4_load(&vx[iR]), f32x4_load(&vz[iR]), f32x4_load(&b[iR]),
                                      k));
    };
    int xf = 1;
    if (width - 1 >= 4) {
        for (; xf + 4 <= width; xf += 4) group(xf);
        if (xf < width) group(width - 4);
        xf = width;
    }
    for (; xf < width; ++xf) {
        const int iL = row + xf - 1;
        const int iR = row + xf;
        storeFace(out.mass, out.momL, out.momR, out.trans, xf,
                  reconstructedFlux(d[iL], qx[iL], qz[iL], b[iL], d[iR], qx[iR], qz[iR], b[iR], g));
    }
    const int last = row + width - 1;
    storeFace(out.mass, out.momL, out.momR, out.trans, width,
              reconstructedFlux(d[last], qx[last], qz[last], b[last],
                                d[last], qx[last], qz[last], b[last], g));
}

/**
 * z-faces of face row `zf` into `out` (width faces): the faces below cell row
 * zf. Rows 0 and height clamp to the edge rows, and the upstream face row
 * (zf == height) takes the inflow ghost when `edgeInflow`. Normal is z here,
 * so qz / vz are normal and qx / vx transverse.
 */
void zFaceRow(const Scratch& s, const float* d, const float* vx, const float* vz, const float* b,
              int width, int height, bool edgeInflow, int zf, const FluxConsts& k, float g,
              const FaceRow& out) {
    const int rowL = ((zf == 0) ? 0 : zf - 1) * width;
    const int rowR = ((zf == height) ? height - 1 : zf) * width;
    const bool ghostR = edgeInflow && zf == height;
    const float* qx = s.qx.data();
    const float* qz = s.qz.data();
    const float* dR  = ghostR ? s.ghostD.data()  : d + rowR;
    const float* qnR = ghostR ? s.ghostQz.data() : qz + rowR;
    const float* qtR = ghostR ? s.ghostQx.data() : qx + rowR;
    const float* unR = ghostR ? s.ghostVz.data() : vz + rowR;
    const float* utR = ghostR ? s.ghostVx.data() : vx + rowR;
    const float* bR  = b + rowR;
    const float* dL  = d + rowL;
    const float* qnL = qz + rowL;
    const float* qtL = qx + rowL;
    const float* unL = vz + rowL;
    const float* utL = vx + rowL;
    const float* bL  = b + rowL;
    const auto group = [&](int x) {
        storeFace4(out.mass, out.momL, out.momR, out.trans, x,
                   reconstructedFlux4(f32x4_load(&dL[x]), f32x4_load(&unL[x]), f32x4_load(&utL[x]), f32x4_load(&bL[x]),
                                      f32x4_load(&dR[x]), f32x4_load(&unR[x]), f32x4_load(&utR[x]), f32x4_load(&bR[x]),
                                      k));
    };
    int x = 0;
    if (width >= 4) {  // overlapping last group, as in xFaceRow
        for (; x + 4 <= width; x += 4) group(x);
        if (x < width) group(width - 4);
        x = width;
    }
    for (; x < width; ++x) {
        storeFace(out.mass, out.momL, out.momR, out.trans, x,
                  reconstructedFlux(dL[x], qnL[x], qtL[x], bL[x], dR[x], qnR[x], qtR[x], bR[x], g));
    }
}

/**
 * Shared step. `edgeInflow` false keeps every boundary transmissive (the
 * stepShallowWater contract); true replaces the upstream (high-row) ghost with
 * upstreamGhost(edgeEta) — lateral and downstream edges stay transmissive.
 */
void stepShallowWaterImpl(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                          int width, int height,
                          float dt, float g, float dx, float H,
                          bool edgeInflow, float edgeEta) {
    if (width <= 0 || height <= 0 || dx <= 0.f || H <= 0.f) return;
    if (width > SWE_MAX_GRID_EXTENT || height > SWE_MAX_GRID_EXTENT) return;
    if (hPtr == 0 || uPtr == 0 || wPtr == 0) return;
    if (dt <= 0.f || g <= 0.f) return;

    Scratch& s = g_scratch;
    s.resize(width, height);
    const int N = width * height;

    const std::span<float> h = heapPlane(hPtr, width, height);
    const std::span<float> u = heapPlane(uPtr, width, height);
    const std::span<float> w = heapPlane(wPtr, width, height);
    // A missing bed reads the zero plane: a flat bed, no per-cell branch.
    const std::span<const float> b = bPtr
        ? std::span<const float>(heapPlane(bPtr, width, height))
        : std::span<const float>(s.zeroBed).first(static_cast<std::size_t>(N));

    float* d  = s.d.data();
    float* qx = s.qx.data();
    float* qz = s.qz.data();
    float* vx = s.vx.data();
    float* vz = s.vz.data();

    // --- Lift (η, u, w) into conserved (d, d·u, d·w), and the CFL max ---
    float maxWaveSpeed = 0.f;
    int i = 0;
    const f32x4 vH = f32x4_splat(H);
    const f32x4 vZero = f32x4_splat(0.f);
    const f32x4 vDry = f32x4_splat(SWE_DRY_DEPTH);
    const f32x4 vG = f32x4_splat(g);
    f32x4 vMaxSpeed = f32x4_splat(0.f);
    for (; i + 4 <= N; i += 4) {
        const f32x4 vh = f32x4_load(&h[i]);
        const f32x4 vb = f32x4_load(&b[i]);
        const f32x4 depth = f32x4_max(vZero, f32x4_sub(f32x4_add(vH, vh), vb));
        f32x4_store(&d[i], depth);

        const f32x4 vu = f32x4_load(&u[i]);
        const f32x4 vw = f32x4_load(&w[i]);
        const f32x4 wet = f32x4_gt(depth, vDry);
        const f32x4 mx = f32x4_and(f32x4_mul(depth, vu), wet);
        const f32x4 mz = f32x4_and(f32x4_mul(depth, vw), wet);
        f32x4_store(&qx[i], mx);
        f32x4_store(&qz[i], mz);
        f32x4_store(&vx[i], f32x4_select(wet, f32x4_div(mx, depth), vZero));
        f32x4_store(&vz[i], f32x4_select(wet, f32x4_div(mz, depth), vZero));

        const f32x4 speed = f32x4_and(
            f32x4_add(
                f32x4_sqrt(f32x4_add(f32x4_mul(vu, vu), f32x4_mul(vw, vw))),
                f32x4_sqrt(f32x4_mul(vG, depth))),
            wet);
        vMaxSpeed = f32x4_max(vMaxSpeed, speed);
    }
    maxWaveSpeed = f32x4_hmax(vMaxSpeed);
    for (; i < N; ++i) {
        const float depth = std::max(0.f, H + h[i] - b[i]);
        d[i] = depth;
        if (depth <= SWE_DRY_DEPTH) {
            qx[i] = 0.f;
            qz[i] = 0.f;
            vx[i] = 0.f;
            vz[i] = 0.f;
        } else {
            qx[i] = depth * u[i];
            qz[i] = depth * w[i];
            vx[i] = qx[i] / depth;
            vz[i] = qz[i] / depth;
            const float speed = std::sqrt(u[i] * u[i] + w[i] * w[i]) + std::sqrt(g * depth);
            maxWaveSpeed = std::max(maxWaveSpeed, speed);
        }
    }

    // Upstream-edge ghosts, from the lifted top row, before the CFL clamp so an
    // incoming stage can never outrun the step.
    if (edgeInflow) {
        const int top = (height - 1) * width;
        for (int x = 0; x < width; ++x) {
            const int iI = top + x;
            const GhostCell c = upstreamGhost(d[iI], h[iI], qz[iI], qx[iI], edgeEta, g);
            s.ghostD[x] = c.d;
            s.ghostQz[x] = c.qz;
            s.ghostQx[x] = c.qx;
            const bool wet = c.d > SWE_DRY_DEPTH;
            s.ghostVz[x] = wet ? c.qz / c.d : 0.f;
            s.ghostVx[x] = wet ? c.qx / c.d : 0.f;
            maxWaveSpeed = std::max(maxWaveSpeed, ghostWaveSpeed(c, g));
        }
    }

    // Everything is dry — nothing to advance, but still write back the clamp.
    if (maxWaveSpeed <= 0.f) {
        for (int k = 0; k < N; ++k) {
            h[k] = d[k] + b[k] - H;
            u[k] = 0.f;
            w[k] = 0.f;
        }
        return;
    }

    // Enforce CFL stability: dt ≤ C · dx / max(|v| + √(g d))
    const float safeDt = std::min(dt, kCflNumber * dx / maxWaveSpeed);
    const float dtdx = safeDt / dx;
    const FluxConsts k(g);

    // --- Fluxes and update, streamed row by row ---
    // Row z needs its own x-faces and the z-faces below and above it. The face
    // above row z is the face below row z + 1, so it is computed once and
    // carried: per row, one x-face row and one z-face row go through HLL, then
    // the row is gathered and written back. Flux scratch is O(width) and stays
    // in L1 at every budget instead of streaming two N-sized planes.
    FaceRow xFaces = s.xFaces.row();
    FaceRow zBelow = s.zFacesA.row();
    FaceRow zAbove = s.zFacesB.row();
    zFaceRow(s, d, vx, vz, b.data(), width, height, edgeInflow, 0, k, g, zBelow);

    const float damp = 1.f - safeDt * DAMPING_COEFF;
    const f32x4 vDtdx = f32x4_splat(dtdx);
    const f32x4 vDamp = f32x4_splat(damp);
    for (int z = 0; z < height; ++z) {
        const int row = z * width;
        xFaceRow(d, qx, qz, vx, vz, b.data(), width, row, k, g, xFaces);
        zFaceRow(s, d, vx, vz, b.data(), width, height, edgeInflow, z + 1, k, g, zAbove);

        // Gather F[left] − F[right] in the operation order of the face-by-face
        // accumulation this replaced (x-face in, x-face out, z-face in, z-face
        // out, from +0), so the host goldens are unchanged. Velocity damping is
        // fused into the write-back.
        // Vector groups; a ragged width ends with an overlapping group (the
        // cells it recomputes read only lifted state, so the rewrite is exact).
        const auto cellGroup = [&](int x) {
            const int c = row + x;
            const auto gather = [&](const float* xin, const float* xout, const float* zin, const float* zout) {
                f32x4 acc = f32x4_add(vZero, f32x4_mul(vDtdx, f32x4_load(&xin[x])));
                acc = f32x4_sub(acc, f32x4_mul(vDtdx, f32x4_load(&xout[x + 1])));
                acc = f32x4_add(acc, f32x4_mul(vDtdx, f32x4_load(&zin[x])));
                return f32x4_sub(acc, f32x4_mul(vDtdx, f32x4_load(&zout[x])));
            };
            const f32x4 accD = gather(xFaces.mass, xFaces.mass, zBelow.mass, zAbove.mass);
            const f32x4 accQx = gather(xFaces.momR, xFaces.momL, zBelow.trans, zAbove.trans);
            const f32x4 accQz = gather(xFaces.trans, xFaces.trans, zBelow.momR, zAbove.momL);

            const f32x4 vb = f32x4_load(&b[c]);
            const f32x4 depth = f32x4_max(vZero, f32x4_add(f32x4_load(&d[c]), accD));
            const f32x4 dry = f32x4_le(depth, vDry);
            const f32x4 nqx = f32x4_add(f32x4_load(&qx[c]), accQx);
            const f32x4 nqz = f32x4_add(f32x4_load(&qz[c]), accQz);
            // Dry: pin the surface to the bed so η reports "no water here"
            // rather than a negative pit the shader would displace into.
            f32x4_store(&h[c], f32x4_select(dry, f32x4_sub(vb, vH),
                                            f32x4_sub(f32x4_add(depth, vb), vH)));
            f32x4_store(&u[c], f32x4_mul(f32x4_select(dry, vZero, f32x4_div(nqx, depth)), vDamp));
            f32x4_store(&w[c], f32x4_mul(f32x4_select(dry, vZero, f32x4_div(nqz, depth)), vDamp));
        };
        int x = 0;
        if (width >= 4) {
            for (; x + 4 <= width; x += 4) cellGroup(x);
            if (x < width) cellGroup(width - 4);
            x = width;
        }
        for (; x < width; ++x) {
            const int c = row + x;
            const auto gather = [&](const float* xin, const float* xout, const float* zin, const float* zout) {
                float acc = 0.f + dtdx * xin[x];
                acc -= dtdx * xout[x + 1];
                acc += dtdx * zin[x];
                return acc - dtdx * zout[x];
            };
            const float accD = gather(xFaces.mass, xFaces.mass, zBelow.mass, zAbove.mass);
            const float accQx = gather(xFaces.momR, xFaces.momL, zBelow.trans, zAbove.trans);
            const float accQz = gather(xFaces.trans, xFaces.trans, zBelow.momR, zAbove.momL);
            const float depth = std::max(0.f, d[c] + accD);
            if (depth <= SWE_DRY_DEPTH) {
                h[c] = b[c] - H;
                u[c] = 0.f * damp;
                w[c] = 0.f * damp;
                continue;
            }
            h[c] = depth + b[c] - H;
            u[c] = ((qx[c] + accQx) / depth) * damp;
            w[c] = ((qz[c] + accQz) / depth) * damp;
        }
        std::swap(zBelow, zAbove);
    }
}

}  // namespace

void stepShallowWater(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                      int width, int height,
                      float dt, float g, float dx, float H) {
    stepShallowWaterImpl(hPtr, uPtr, wPtr, bPtr, width, height, dt, g, dx, H, false, 0.f);
}

void stepShallowWaterInflow(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                            int width, int height,
                            float dt, float g, float dx, float H, float edgeEta) {
    const float eta = std::isfinite(edgeEta) ? edgeEta : 0.f;
    stepShallowWaterImpl(hPtr, uPtr, wPtr, bPtr, width, height, dt, g, dx, H, true, eta);
}

// Kernel tuning — twin of HYDRO_* in src/systems/water/hydroEvents.ts (#397).
// Keep the two in lockstep; hydroEvents.test.ts pins the TypeScript half.
static constexpr float kHydroInflowDownstream = 0.5f;
static constexpr float kHydroVortexSink = 0.35f;
static constexpr float kHydroBraidLateral = 0.75f;

void applySWEEvent(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                   int width, int height, float dx, float originX, float originZ, float H,
                   int kind, float cx, float cz, float radius, float strength, float dt) {
    if (width <= 0 || height <= 0 || dx <= 0.f) return;
    if (width > SWE_MAX_GRID_EXTENT || height > SWE_MAX_GRID_EXTENT) return;
    if (hPtr == 0 || uPtr == 0 || wPtr == 0) return;
    // A non-finite placement has no cells; before #467 it wrote NaN everywhere.
    if (!std::isfinite(originX) || !std::isfinite(originZ) || !std::isfinite(dx)
        || !std::isfinite(cx) || !std::isfinite(cz) || !std::isfinite(radius)) return;
    const std::span<float> h = heapPlane(hPtr, width, height);
    const std::span<float> u = heapPlane(uPtr, width, height);
    const std::span<float> w = heapPlane(wPtr, width, height);
    const std::span<float> b = heapPlane(bPtr, width, height);
    const float r = std::max(0.5f, radius);
    const float r2 = r * r;
    const float mag = std::max(0.f, strength);
    const float step = std::max(0.f, dt);
    const float still = H > 0.f ? H : 1.2f;

    // Only the event's bounding box can be inside the radius (#467): the scan
    // used to visit every cell for every event. One cell of margin each way
    // keeps rounding at the box edge on the conservative side; the exact
    // `d2 > r2` test below still decides, so the result is unchanged.
    const auto cellRange = [dx](float lo, float hi, float origin, int extent, int& first, int& last) {
        const float a = std::floor((lo - origin) / dx) - 1.f;
        const float c = std::ceil((hi - origin) / dx) + 1.f;
        first = static_cast<int>(std::clamp(a, 0.f, static_cast<float>(extent)));
        last = static_cast<int>(std::clamp(c, -1.f, static_cast<float>(extent - 1)));
    };
    int i0, i1, j0, j1;
    cellRange(cx - r, cx + r, originX, width, i0, i1);
    cellRange(cz - r, cz + r, originZ, height, j0, j1);

    for (int j = j0; j <= j1; ++j) {
        const float wz = originZ + static_cast<float>(j) * dx;
        const float dz = wz - cz;
        for (int i = i0; i <= i1; ++i) {
            const float wx = originX + static_cast<float>(i) * dx;
            const float ddx = wx - cx;
            const float d2 = ddx * ddx + dz * dz;
            if (d2 > r2) continue;
            const float dist = std::sqrt(d2);
            const float wgt = 1.f - dist / r;
            const std::size_t idx = static_cast<std::size_t>(j) * width + i;
            if (kind == 0) {
                h[idx] += mag * step * wgt;
                // Downstream is -Z; the released volume arrives moving.
                w[idx] -= mag * step * wgt * kHydroInflowDownstream;
            } else if (kind == 1) {
                h[idx] -= mag * step * wgt * kHydroVortexSink;
                const float inv = dist > 1e-4f ? 1.f / dist : 0.f;
                u[idx] += -dz * inv * mag * step * wgt;
                w[idx] += ddx * inv * mag * step * wgt;
            } else if (kind == 2 && !b.empty()) {
                // Authored shoal elevation, applied as a maximum so repeated
                // steps are idempotent and never creep to the dry clamp.
                const float shoal = std::min(mag * wgt, still + 2.f);
                if (shoal > b[idx]) b[idx] = shoal;
                // Water goes around the shoal, not through it.
                const float side = ddx >= 0.f ? 1.f : -1.f;
                u[idx] += side * mag * step * wgt * kHydroBraidLateral;
            } else if (kind == 3) {
                const float damp = std::max(0.f, 1.f - mag * step * wgt);
                u[idx] *= damp;
                w[idx] *= damp;
            }
        }
    }
}

namespace {

/** Reused across calls so a per-frame scroll never allocates after the first. */
thread_local std::vector<float> g_scrollTmp;

/**
 * dst[x, z] = src[x - shiftX, z - shiftZ], in place via `tmp`.
 * Out-of-range sources become `fill`, or the nearest edge cell when `clampEdge`.
 * Row by row (#467): the in-range span of each row is one copy and the
 * out-of-range ends are fills, instead of a bounds test per element.
 */
void scrollPlane(std::span<float> plane, std::span<float> tmp, int width, int height,
                 int shiftX, int shiftZ, float fill, bool clampEdge) {
    const std::size_t w = static_cast<std::size_t>(width);
    // Columns whose source is in range: x in [x0, x1).
    const int x0 = std::clamp(shiftX, 0, width);
    const int x1 = std::clamp(width + shiftX, 0, width);
    for (int z = 0; z < height; ++z) {
        const std::span<float> dst = tmp.subspan(static_cast<std::size_t>(z) * w, w);
        const int sz = z - shiftZ;
        const bool rowInRange = sz >= 0 && sz < height;
        if (!rowInRange && !clampEdge) {
            std::fill(dst.begin(), dst.end(), fill);
            continue;
        }
        const std::span<const float> src = plane.subspan(static_cast<std::size_t>(std::clamp(sz, 0, height - 1)) * w, w);
        if (!rowInRange || x1 <= x0) {
            // Whole row from the edge (clampEdge) — the clamped source column.
            for (int x = 0; x < width; ++x) {
                const int sx = x - shiftX;
                dst[x] = (sx >= 0 && sx < width && rowInRange) ? src[sx]
                       : clampEdge ? src[std::clamp(sx, 0, width - 1)] : fill;
            }
            continue;
        }
        std::fill(dst.begin(), dst.begin() + x0, clampEdge ? src[0] : fill);
        const std::span<const float> moved = src.subspan(static_cast<std::size_t>(x0 - shiftX),
                                                         static_cast<std::size_t>(x1 - x0));
        std::copy(moved.begin(), moved.end(), dst.begin() + x0);
        std::fill(dst.begin() + x1, dst.end(), clampEdge ? src[w - 1] : fill);
    }
    std::copy(tmp.begin(), tmp.begin() + static_cast<std::ptrdiff_t>(plane.size()), plane.begin());
}

}  // namespace

void scrollShallowWater(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                        int width, int height, int shiftX, int shiftZ,
                        float inflowEta, float inflowU, float inflowW) {
    if (width <= 0 || height <= 0) return;
    if (width > SWE_MAX_GRID_EXTENT || height > SWE_MAX_GRID_EXTENT) return;
    if (hPtr == 0 || uPtr == 0 || wPtr == 0) return;
    // Beyond one full extent every source is out of range anyway; saturating
    // here keeps `x - shift` clear of int overflow for a teleport-sized delta.
    shiftX = std::clamp(shiftX, -width, width);
    shiftZ = std::clamp(shiftZ, -height, height);
    if (shiftX == 0 && shiftZ == 0) return;

    g_scrollTmp.resize(static_cast<std::size_t>(width) * static_cast<std::size_t>(height));
    const std::span<float> tmp{g_scrollTmp};

    scrollPlane(heapPlane(hPtr, width, height), tmp, width, height, shiftX, shiftZ, inflowEta, false);
    scrollPlane(heapPlane(uPtr, width, height), tmp, width, height, shiftX, shiftZ, inflowU,   false);
    scrollPlane(heapPlane(wPtr, width, height), tmp, width, height, shiftX, shiftZ, inflowW,   false);
    if (bPtr != 0) {
        scrollPlane(heapPlane(bPtr, width, height), tmp, width, height, shiftX, shiftZ, 0.f, true);
    }
}

void reserveShallowWaterScratch(int width, int height) {
    if (width <= 0 || height <= 0) return;
    if (width > SWE_MAX_GRID_EXTENT || height > SWE_MAX_GRID_EXTENT) return;
    g_scratch.resize(width, height);
    g_scrollTmp.reserve(static_cast<std::size_t>(width) * static_cast<std::size_t>(height));
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
