/**
 * `gpu-chores` — WASM and TypeScript lanes.
 *
 * Both lanes share one implementation and differ only in `useWasm`. The WASM
 * lane declines when chore exports are missing so `auto` slides to `ts`
 * rather than silently producing nothing.
 */

import {
  blurSeparableF32,
  downsampleF32,
  histogramF32,
  lumaHistogramU8,
  reduceF32,
} from './cpuMath';
import type {
  ChoreBackend,
  ChoreBackendImpl,
  ChoreJob,
  ChoreOutput,
  Downsample2dJob,
  GridReduceJob,
  LumaHistogramJob,
  SeparableBlurJob,
} from './types';

export interface CpuChoreHost {
  isWasmReady(): boolean;
  reduceF32(values: Float32Array, useWasm: boolean): ReturnType<typeof reduceF32>;
  histogramF32(
    values: Float32Array,
    rangeMin: number | undefined,
    rangeMax: number | undefined,
    useWasm: boolean,
  ): ReturnType<typeof histogramF32>;
  lumaHistogramU8(rgba: Uint8Array | Uint8ClampedArray, pixelCount: number, useWasm: boolean): ReturnType<typeof lumaHistogramU8>;
  downsampleF32(
    values: Float32Array,
    width: number,
    height: number,
    destWidth: number,
    destHeight: number,
    useWasm: boolean,
  ): ReturnType<typeof downsampleF32>;
  blurSeparableF32(
    values: Float32Array,
    width: number,
    height: number,
    useWasm: boolean,
  ): ReturnType<typeof blurSeparableF32>;
}

function hasCpuSource(job: ChoreJob): boolean {
  if (job.op === 'luma-histogram') {
    return !!job.values && job.values.length > 0;
  }
  return !!job.values && job.values.length > 0;
}

export class CpuChoreBackend implements ChoreBackendImpl {
  readonly backend: ChoreBackend;

  private readonly host: CpuChoreHost;
  private readonly useWasm: boolean;

  constructor(backend: 'wasm' | 'ts', host: CpuChoreHost) {
    this.backend = backend;
    this.host = host;
    this.useWasm = backend === 'wasm';
  }

  canRun(job: ChoreJob): boolean {
    if (!hasCpuSource(job)) return false;
    if (this.useWasm && !this.host.isWasmReady()) return false;
    return true;
  }

  declineReason(job: ChoreJob): string {
    if (!hasCpuSource(job)) return 'No CPU source buffer';
    if (this.useWasm && !this.host.isWasmReady()) return 'WASM chore exports not ready';
    return 'Unavailable';
  }

  run(job: ChoreJob): Promise<ChoreOutput | null> {
    if (!this.canRun(job)) return Promise.resolve(null);
    return Promise.resolve(this.execute(job));
  }

  private execute(job: ChoreJob): ChoreOutput | null {
    switch (job.op) {
      case 'grid-reduce':
        return this.host.reduceF32((job as GridReduceJob).values as Float32Array, this.useWasm);
      case 'luma-histogram':
        return this.executeHistogram(job);
      case 'downsample-2d':
        return this.host.downsampleF32(
          job.values as Float32Array,
          job.width,
          job.height,
          job.destWidth,
          job.destHeight,
          this.useWasm,
        );
      case 'separable-blur':
        return this.host.blurSeparableF32(
          job.values as Float32Array,
          job.width,
          job.height,
          this.useWasm,
        );
      default:
        return null;
    }
  }

  private executeHistogram(job: LumaHistogramJob): ChoreOutput | null {
    const values = job.values;
    if (!values) return null;
    const channels = job.channels ?? (values.length >= job.width * job.height * 4 ? 4 : 1);
    if (channels === 4) {
      const rgba =
        values instanceof Uint8Array || values instanceof Uint8ClampedArray
          ? values
          : new Uint8ClampedArray(
              Float32Array.from(values as Float32Array).map((v) => Math.round(v * 255)),
            );
      return this.host.lumaHistogramU8(rgba, job.width * job.height, this.useWasm);
    }
    if (!(values instanceof Float32Array)) {
      return histogramF32(values as ArrayLike<number>, job.width * job.height, job.rangeMin, job.rangeMax);
    }
    return this.host.histogramF32(values, job.rangeMin, job.rangeMax, this.useWasm);
  }
}

export function createTsCpuHost(): CpuChoreHost {
  return {
    isWasmReady: () => false,
    reduceF32: (values) => reduceF32(values),
    histogramF32: (values, rangeMin, rangeMax) => histogramF32(values, values.length, rangeMin, rangeMax),
    lumaHistogramU8: (rgba, pixelCount) => lumaHistogramU8(rgba, pixelCount),
    downsampleF32: (values, width, height, destWidth, destHeight) =>
      downsampleF32(values, width, height, destWidth, destHeight),
    blurSeparableF32: (values, width, height) => blurSeparableF32(values, width, height),
  };
}

export type { Downsample2dJob, GridReduceJob, LumaHistogramJob, SeparableBlurJob };
