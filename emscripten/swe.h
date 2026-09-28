/**
 * swe.h — public declarations for the shallow-water solver + heap grid helpers.
 *
 * Implemented in swe.cpp. Embind-free — bindings.cpp includes this header
 * and registers the Embind surface separately.
 */

#ifndef WATERSHED_SWE_H
#define WATERSHED_SWE_H

#include "common.h"
#include <cstdint>

/**
 * Advance the nonlinear shallow-water grid one CFL-clamped time step.
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
 * @param dt     Desired time step (s) — internally CFL-clamped
 * @param g      Gravity (m/s²)
 * @param dx     Cell size (m)
 * @param H      Still-water depth over a zero bed (m)
 */
void stepShallowWater(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                      int width, int height,
                      float dt, float g, float dx, float H);

/**
 * Authored hydro event source term (ABI 8, additive).
 *
 * kind: 0 inflowPulse (raises η), 1 vortex (lowers η + swirl), 2 braid (raises b),
 *       3 roughness (damps u,w). Applied in world XZ on the player-centred grid.
 */
void applySWEEvent(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
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
 */
void scrollShallowWater(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                        int width, int height, int shiftX, int shiftZ,
                        float inflowEta, float inflowU, float inflowW);

/** Depth below which a cell counts as dry (m). Mirrored by host goldens. */
extern const float SWE_DRY_DEPTH;

/** Allocate `count` zero-initialised floats in the WASM heap; returns a byte offset. */
uintptr_t allocateGrid(int count);

/** Free a pointer previously returned by allocateGrid. */
void freeGrid(uintptr_t ptr);

#endif  // WATERSHED_SWE_H
