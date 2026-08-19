/**
 * chores.h — generic image/grid helpers (gpu-chores WASM lane).
 *
 * Embind-free. Not SWE / flow / water-force math. Optional ABI 5 exports;
 * MIN_WASM_ABI_VERSION stays 4 so older binaries still load for forces.
 */

#ifndef WATERSHED_CHORES_H
#define WATERSHED_CHORES_H

#include "common.h"
#include <cstdint>

/** Write min, max, mean (3 floats) for `count` source floats. */
void reduceF32Grid(uintptr_t src, int count, uintptr_t out3);

/** 256-bin histogram of scalar floats into `binsPtr` (256 uint32). */
void histogramF32(uintptr_t src, int count, float rangeMin, float rangeMax, uintptr_t binsPtr);

/** 256-bin BT.709 luma histogram of packed RGBA8. */
void lumaHistogramU8(uintptr_t rgba, int pixelCount, uintptr_t binsPtr);

/** Box-filter downsample of a row-major f32 grid. */
void downsampleF32(uintptr_t src, int srcW, int srcH, uintptr_t dst, int dstW, int dstH);

/** Separable 3-tap [0.25, 0.5, 0.25] blur. */
void blurSeparableF32(uintptr_t src, uintptr_t dst, int width, int height);

#endif  // WATERSHED_CHORES_H
