/**
 * `gpu-chores` — shared kit API shapes (Tier B / Watershed #369).
 *
 * Chromashift #132 / PR #139 is the hist-reference facade. These types stay
 * app-agnostic: nothing here imports SWE, HeightmapFlow, or TSL materials.
 *
 * Backend order is WebGPU → WASM → JS. WebGL2 is deliberately not a lane.
 */

/** Concrete execution lanes, in the order the facade prefers them. */
export type ChoreBackend = 'webgpu' | 'wasm' | 'ts';

/**
 * Caller-facing lane selection.
 * - `auto` — walk the preference order; first lane that accepts the job wins.
 * - `webgpu` / `wasm` / `ts` — pin a single lane; the facade declines rather
 *   than silently sliding, which keeps parity tests honest.
 */
export type ChorePreference = 'auto' | ChoreBackend;

/**
 * Canonical fallback order. WebGL2 is absent: atomics/histogram have no
 * workable GL2 story, and running a compute device *and* a GL context for one
 * job is the failure mode this kit exists to prevent.
 */
export const CHORE_BACKEND_ORDER: readonly ChoreBackend[] = ['webgpu', 'wasm', 'ts'];

export const HISTOGRAM_BINS = 256;

export type ChoreOp = 'grid-reduce' | 'luma-histogram' | 'downsample-2d' | 'separable-blur';

export interface GridReduceJob {
  op: 'grid-reduce';
  /** CPU height / scalar field. Required by the wasm/ts lanes. */
  values?: Float32Array | null;
  /** GPU-resident source. Required by the webgpu lane. */
  source?: GPUTexture | null;
  width: number;
  height: number;
  prefer?: ChorePreference;
}

export interface GridReduceOutput {
  kind: 'grid-reduce';
  min: number;
  max: number;
  mean: number;
  count: number;
}

export interface LumaHistogramJob {
  op: 'luma-histogram';
  /**
   * Scalar heights (`channels: 1`) or packed RGBA (`channels: 4`).
   * Uint8 RGBA is BT.709 luma; Float32 scalar is binned against rangeMin/Max.
   */
  values?: Float32Array | Uint8Array | Uint8ClampedArray | null;
  source?: GPUTexture | null;
  width: number;
  height: number;
  channels?: 1 | 4;
  rangeMin?: number;
  rangeMax?: number;
  prefer?: ChorePreference;
}

export interface LumaHistogramOutput {
  kind: 'luma-histogram';
  bins: Uint32Array;
  count: number;
}

export interface Downsample2dJob {
  op: 'downsample-2d';
  values?: Float32Array | null;
  source?: GPUTexture | null;
  width: number;
  height: number;
  destWidth: number;
  destHeight: number;
  prefer?: ChorePreference;
}

export interface Downsample2dOutput {
  kind: 'downsample-2d';
  values: Float32Array;
  width: number;
  height: number;
}

export interface SeparableBlurJob {
  op: 'separable-blur';
  values?: Float32Array | null;
  source?: GPUTexture | null;
  width: number;
  height: number;
  prefer?: ChorePreference;
}

export interface SeparableBlurOutput {
  kind: 'separable-blur';
  values: Float32Array;
  width: number;
  height: number;
}

export type ChoreJob =
  | GridReduceJob
  | LumaHistogramJob
  | Downsample2dJob
  | SeparableBlurJob;

export type ChoreOutput =
  | GridReduceOutput
  | LumaHistogramOutput
  | Downsample2dOutput
  | SeparableBlurOutput;

export interface ChoreSuccess<T extends ChoreOutput = ChoreOutput> {
  ok: true;
  backend: ChoreBackend;
  value: T;
}

export interface ChoreAttempt {
  backend: ChoreBackend;
  outcome: 'declined' | 'failed';
  reason: string;
}

export interface ChoreFailure {
  ok: false;
  backend: null;
  reason: string;
  attempts: readonly ChoreAttempt[];
}

export type ChoreResult<T extends ChoreOutput = ChoreOutput> = ChoreSuccess<T> | ChoreFailure;

export interface ChoreBackendImpl {
  readonly backend: ChoreBackend;
  canRun(job: ChoreJob): boolean;
  declineReason(job: ChoreJob): string;
  run(job: ChoreJob): Promise<ChoreOutput | null>;
  destroy?(): void;
}

export interface ChoresRuntime {
  runJob<T extends ChoreOutput = ChoreOutput>(job: ChoreJob): Promise<ChoreResult<T>>;
  availableBackends(): readonly ChoreBackend[];
  destroy(): void;
}
