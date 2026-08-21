/**
 * swe.h — public declarations for the shallow-water solver + heap grid helpers.
 *
 * Implemented in swe.cpp. Embind-free — bindings.cpp includes this header
 * and registers the Embind surface separately.
 *
 * The solver is a conservative finite-volume shallow-water step (Rusanov flux
 * with Audusse hydrostatic reconstruction) over the primitive state
 * (h, u, w) plus an optional bed elevation b. It supports wetting/drying:
 * cells whose depth falls below SWE_DRY_DEPTH are clamped dry and hold no
 * momentum, which is what lets a slot-canyon bed read differently from a
 * delta instead of being a palette swap.
 */

#ifndef WATERSHED_SWE_H
#define WATERSHED_SWE_H

#include "common.h"
#include <cstdint>

/** Depth (m) below which a cell is treated as dry: no velocity, no flux. */
static constexpr float SWE_DRY_DEPTH = 1e-4f;

/** Upper bound on CFL substeps taken inside one stepShallowWater call. */
static constexpr int SWE_MAX_SUBSTEPS = 8;

/** Courant number used for the internal substep clamp. */
static constexpr float SWE_CFL_NUMBER = 0.45f;

/**
 * Advance the shallow-water grid by `dt` over a flat bed (b == 0).
 *
 * `h` is total water depth (m, >= 0), not a perturbation. CFL substepping is
 * enforced inside C++; JS only passes the frame delta.
 *
 * @param H  Reference depth (m) used only as the dry-state wave-speed floor
 *           for the substep estimate. It no longer linearises the solver.
 */
void stepShallowWater(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr,
                      int width, int height,
                      float dt, float g, float dx, float H);

/**
 * Advance the shallow-water grid by `dt` over a bed elevation field.
 *
 * @param bPtr Heap pointer to the bed elevation grid (m), or 0 for a flat bed.
 *             The scheme is well-balanced: still water (h + b constant) over an
 *             arbitrary bed generates no current beyond float round-off.
 */
void stepShallowWaterBed(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr,
                         uintptr_t bPtr,
                         int width, int height,
                         float dt, float g, float dx, float H);

/** Allocate `count` zero-initialised floats in the WASM heap; returns a byte offset. */
uintptr_t allocateGrid(int count);

/** Free a pointer previously returned by allocateGrid. */
void freeGrid(uintptr_t ptr);

#endif  // WATERSHED_SWE_H
