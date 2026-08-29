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

/** Depth below which a cell counts as dry (m). Mirrored by host goldens. */
extern const float SWE_DRY_DEPTH;

/** Allocate `count` zero-initialised floats in the WASM heap; returns a byte offset. */
uintptr_t allocateGrid(int count);

/** Free a pointer previously returned by allocateGrid. */
void freeGrid(uintptr_t ptr);

#endif  // WATERSHED_SWE_H
