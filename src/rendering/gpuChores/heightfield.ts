/**
 * Heightfield chore jobs used by WaterForceSystem / DebugPanel.
 *
 * Reads the CPU `grid.h` view (already on the JS heap). Does not step SWE.
 */

import { getChoresRuntime } from './createRuntime';
import { setGpuChoreStats } from './statsStore';
import type { Downsample2dOutput, GridReduceOutput, LumaHistogramOutput } from './types';

const THUMB_WIDTH = 32;
let inFlight = false;

export function runHeightfieldChores(
  values: Float32Array,
  width: number,
  height: number,
): void {
  if (inFlight || width <= 0 || height <= 0 || values.length === 0) return;
  inFlight = true;
  const runtime = getChoresRuntime();
  const destWidth = THUMB_WIDTH;
  const destHeight = Math.max(1, Math.round((THUMB_WIDTH * height) / width));

  void (async () => {
    try {
      const reduce = await runtime.runJob<GridReduceOutput>({
        op: 'grid-reduce',
        values,
        width,
        height,
        prefer: 'auto',
      });
      if (!reduce.ok || reduce.value.kind !== 'grid-reduce') {
        setGpuChoreStats({
          backend: null,
          reason: reduce.ok ? 'Unexpected reduce result' : reduce.reason,
        });
        return;
      }

      const hist = await runtime.runJob<LumaHistogramOutput>({
        op: 'luma-histogram',
        values,
        width,
        height,
        channels: 1,
        rangeMin: reduce.value.min,
        rangeMax: reduce.value.max,
        prefer: 'auto',
      });

      const down = await runtime.runJob<Downsample2dOutput>({
        op: 'downsample-2d',
        values,
        width,
        height,
        destWidth,
        destHeight,
        prefer: 'auto',
      });

      let thumb: { values: Float32Array; width: number; height: number } | null = null;
      if (down.ok && down.value.kind === 'downsample-2d') {
        const blurred = await runtime.runJob({
          op: 'separable-blur',
          values: down.value.values,
          width: down.value.width,
          height: down.value.height,
          prefer: 'auto',
        });
        if (blurred.ok && blurred.value.kind === 'separable-blur') {
          thumb = {
            values: blurred.value.values,
            width: blurred.value.width,
            height: blurred.value.height,
          };
        } else {
          thumb = {
            values: down.value.values,
            width: down.value.width,
            height: down.value.height,
          };
        }
      }

      setGpuChoreStats({
        backend: reduce.backend,
        reason: null,
        min: reduce.value.min,
        max: reduce.value.max,
        mean: reduce.value.mean,
        histogram: hist.ok && hist.value.kind === 'luma-histogram' ? hist.value.bins : null,
        thumb,
      });
    } finally {
      inFlight = false;
    }
  })();
}

export function resetHeightfieldChoresInFlight(): void {
  inFlight = false;
}
