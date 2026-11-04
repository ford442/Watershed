/**
 * chores.h — generic image/grid helpers (gpu-chores WASM lane).
 *
 * Host-clean (no Emscripten headers). Not SWE / flow / water-force math. Optional ABI 5 exports;
 * MIN_WASM_ABI_VERSION stays 4 so older binaries still load for forces.
 */

#ifndef WATERSHED_CHORES_H
#define WATERSHED_CHORES_H

#include "common.h"
#include <cstdint>

/** Write min, max, mean (3 floats) for `count` source floats. */
int reduceF32Grid(uintptr_t src, int count, uintptr_t out3);

/** 256-bin histogram of scalar floats into `binsPtr` (256 uint32). */
int histogramF32(uintptr_t src, int count, float rangeMin, float rangeMax, uintptr_t binsPtr);

/** 256-bin BT.709 luma histogram of packed RGBA8. */
int lumaHistogramU8(uintptr_t rgba, int pixelCount, uintptr_t binsPtr);

/** Box-filter downsample of a row-major f32 grid. */
int downsampleF32(uintptr_t src, int srcW, int srcH, uintptr_t dst, int dstW, int dstH);

/** Separable 3-tap [0.25, 0.5, 0.25] blur. */
int blurSeparableF32(uintptr_t src, uintptr_t dst, int width, int height);

/**
 * The SWE flow texture's bytes (#533): RGBA f32 per cell, row-major like `h`,
 *   R = u, G = w (m/s), B = depth = max(0, (H + h) − b) (m),
 *   A = div = ∂u/∂x + ∂w/∂z (1/s), central differences, one-sided (half span)
 *       on the border, 0 on a dry cell (depth ≤ SWE_DRY_DEPTH) or along an
 *       axis of extent 1.
 * The layout src/systems/water/sweSurfaceField.ts documents and the water
 * shaders sample (`sweFlowMap`). Every operation is a float32 op in a fixed
 * order, so sweSurfaceField.drift.test.ts pins the bytes against an
 * fround-exact TypeScript statement of the same stencil.
 *
 * `bPtr` 0 is a flat bed. `outRgba` holds 4 · width · height floats and must
 * not alias the inputs. Returns WS_OK, or WS_REJECTED (nothing written) for a
 * bad extent, a null plane, a non-finite H, or dx not finite and > 0.
 */
int packSurfaceField(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                     int width, int height, float H, float dx, uintptr_t outRgba);

#endif  // WATERSHED_CHORES_H
