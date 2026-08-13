/**
 * swe.h — public declarations for the shallow-water solver + heap grid helpers.
 *
 * Implemented in swe.cpp. Embind-free — bindings.cpp includes this header
 * and registers the Embind surface separately.
 */

#ifndef WATERSHED_SWE_H
#define WATERSHED_SWE_H

#include "common.h"

/** Advance the linearised shallow-water grid one CFL-clamped time step. */
void stepShallowWater(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr,
                      int width, int height,
                      float dt, float g, float dx, float H);

/** Allocate `count` zero-initialised floats in the WASM heap; returns a byte offset. */
uintptr_t allocateGrid(int count);

/** Free a pointer previously returned by allocateGrid. */
void freeGrid(uintptr_t ptr);

#endif  // WATERSHED_SWE_H
