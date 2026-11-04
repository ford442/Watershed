/**
 * swe.h — public declarations for the shallow-water solver + heap grid helpers.
 *
 * Implemented in swe.cpp. Host-clean — bindings.cpp includes this header
 * and exports the C ABI (ws_*) separately.
 */

#ifndef WATERSHED_SWE_H
#define WATERSHED_SWE_H

#include "common.h"
#include <cstdint>

/**
 * Advance the nonlinear shallow-water grid by `dt`, in CFL-clamped sub-steps.
 *
 * Conservative finite-volume update (HLL flux + Audusse hydrostatic
 * reconstruction) with wetting/drying. Well-balanced: a flat free surface over
 * an arbitrary bed stays at rest.
 *
 * Field conventions — these are the ABI, do not change them silently:
 *   h[i]  free-surface PERTURBATION η (m), 0 at rest. This is what the
 *         DataTexture uploads and FlowingWater displaces by, so it must stay a
 *         perturbation rather than an absolute depth.
 *   u,w   velocity components (m/s).
 *   b[i]  bed elevation above the channel floor datum (m), 0 = full depth H.
 *         `bPtr == 0` is a flat bed. Total water depth is H + η − b.
 *
 * @param hPtr   Free-surface perturbation field (WASM heap byte offset)
 * @param uPtr   X-velocity field
 * @param wPtr   Z-velocity field
 * @param bPtr   Bed elevation field, or 0 for a flat bed
 * @param width  Grid columns
 * @param height Grid rows
 * Time contract (ABI 17, #533): the step sub-cycles — at most 4 CFL steps
 * (dt ≤ 0.4·dx / max(|v| + √(g d)) each), each re-lifted from the state the
 * previous one wrote back — and RETURNS the time it integrated: `dt` exactly
 * unless the sub-step cap was hit, in which case the caller carries the rest
 * (sweHost.ts puts it back in its step accumulator). 0 means the call was
 * rejected and nothing was written: an extent outside [1, SWE_MAX_GRID_EXTENT],
 * a null plane, or a dt / g / dx / H that is not finite and > 0.
 *
 * Velocities are damped by exp(−DAMPING_COEFF·dt) per sub-step (sweExpNeg),
 * so the factor is in (0, 1] for any dt. A non-finite η, u or w is read as 0
 * by the lift, so a NaN cell heals instead of spreading.
 *
 * @param dt     Time to integrate (s), finite and > 0
 * @param g      Gravity (m/s²)
 * @param dx     Cell size (m)
 * @param H      Still-water depth over a zero bed (m)
 * @returns      Time integrated (s), in [0, dt]
 */
float stepShallowWater(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                       int width, int height,
                       float dt, float g, float dx, float H);

/**
 * stepShallowWater with the upstream edge driven by routed discharge (ABI 10,
 * additive — stepShallowWater itself is unchanged).
 *
 * Downstream is −Z, so the upstream edge is the face above the last row
 * (row height − 1): the side the player is leaving, and the side scroll
 * drops cells off when the window travels downstream. That face's ghost is
 * built from characteristics (see upstreamGhost in swe.cpp): the stage
 * `edgeEta` (a free-surface perturbation, same datum as `h`) enters as a
 * simple wave, and waves reaching the edge from inside still leave. Lateral and
 * downstream edges stay transmissive.
 *
 * `edgeEta == 0` over a still interior is exactly the rest state, so
 * lake-at-rest holds bit-for-bit. routing.h's routedEdgeState turns a routed
 * discharge into `edgeEta`. Non-finite `edgeEta` is treated as 0.
 *
 * Returns the time integrated, as stepShallowWater.
 */
float stepShallowWaterInflow(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                             int width, int height,
                             float dt, float g, float dx, float H, float edgeEta);

/**
 * Authored hydro event source term (ABI 8, additive).
 *
 * kind: 0 inflowPulse (raises η), 1 vortex (lowers η + swirl), 2 braid (raises b),
 *       3 roughness (damps u,w), 4 surge (ABI 14: a stage-step front — a band
 *       |z − cz| ≤ radius across the whole window, cx unused — that raises η
 *       toward `strength` metres and gives the water the downstream speed a bore
 *       of that height carries). Applied in world XZ on the player-centred grid.
 *
 * Returns WS_OK, or WS_REJECTED (nothing written) for a bad extent, a null
 * plane, dx ≤ 0, or a non-finite placement / strength / dt.
 */
int applySWEEvent(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                  int width, int height, float dx, float originX, float originZ, float H,
                  int kind, float cx, float cz, float radius, float strength, float dt);

/**
 * Scroll the whole field through the grid's index frame by whole cells
 * (ABI 9, additive).
 *
 * The grid is a moving window over the world: every frame the window origin
 * follows the vehicle, and `b` is re-rasterized into the new window. h / u / w
 * carry state, so they have to move with the world or a splash rides the
 * camera. Call this with the whole-cell origin delta *before* the bed refresh
 * and the step.
 *
 * Sign convention — `shift` is how far the CONTENT moves through the index
 * frame, so it equals (oldOrigin - newOrigin) / dx per axis:
 *
 *     dst[x, z] = src[x - shiftX, z - shiftZ]
 *
 * A window that travels downstream (-Z, gameplay-forward) has a POSITIVE
 * shiftZ: the field slides toward higher rows, water leaves off the high-row
 * (upstream) edge, and the new low-row (downstream) edge is filled. World
 * position of a cell, originZ + row * dx, is unchanged for every surviving cell.
 *
 * Cells that leave the window are dropped — nothing wraps. Cells that enter
 * take the inflow state: (h, u, w) = (inflowEta, inflowU, inflowW). Pass zeros
 * for rest state. These are the ABI's own fields (a perturbation and
 * velocities), not a depth and a flux: total depth needs the bed, and the bed
 * for an entering cell is only known once the rasterizer has run. The bed plane
 * entering cells take is the nearest surviving edge value (constant
 * extension), which is only a placeholder for the one frame before the
 * rasterizer overwrites it.
 *
 * Pure data movement, no arithmetic: the result is bit-exact and identical to
 * the WGSL twin (`scroll` in swe.wgsl). |shift| >= the grid extent on an axis
 * saturates — the whole field is replaced. Sub-cell motion is the caller's to
 * absorb (WaterForceSystem quantizes the window origin to the cell lattice).
 *
 * @param bPtr  Bed plane, or 0 to leave the bed alone (flat bed)
 * @returns     WS_OK (a zero shift included), or WS_REJECTED for a bad extent / null plane
 */
int scrollShallowWater(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                       int width, int height, int shiftX, int shiftZ,
                       float inflowEta, float inflowU, float inflowW);

/**
 * Size the solver's reused scratch (step, upstream-edge ghosts, scroll temp)
 * for a width x height grid up front, so the first stepShallowWater[Inflow] /
 * scrollShallowWater does not allocate mid-call. Call once after allocating the
 * grid planes. Optional: without it the buffers grow lazily on first use, as
 * before. Safe to call again for a different size.
 */
void reserveShallowWaterScratch(int width, int height);

// SWE_MAX_GRID_EXTENT (the largest width / height any entry point accepts)
// lives in common.h since #511: chores.cpp guards against it too.

/** Depth below which a cell counts as dry (m). Mirrored by host goldens. */
extern const float SWE_DRY_DEPTH;

/**
 * Allocate `count` zero-initialised floats in the WASM heap; returns a byte
 * offset, or 0 for count <= 0, count > WS_MAX_ELEMENTS, or an exhausted heap
 * (the TS binding turns a 0 for count > 0 into WasmHeapExhaustedError).
 */
uintptr_t allocateGrid(int count);

/** Free a pointer previously returned by allocateGrid. */
void freeGrid(uintptr_t ptr);

#endif  // WATERSHED_SWE_H
