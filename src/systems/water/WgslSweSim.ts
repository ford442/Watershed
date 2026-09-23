/**
 * WgslSweSim — the WGSL twin of the C++ SWE stepper (#435), on the renderer's
 * own GPUDevice.
 *
 * Numerics live in `swe.wgsl` (a line-for-line port of emscripten/swe.cpp and
 * applySWEEvent). This file owns buffers, dispatch order, and the CPU mirror:
 *
 *   step():  [upload splash delta → add_surface] → clear max → lift → update
 *            → apply_events (32 per dispatch) → copy field → staging
 *   then an async map of the staging buffer refreshes h/u/w/b and bumps
 *   `fieldVersion`. At most one readback is in flight; a step that lands while
 *   one is pending still runs on the GPU, it just is not mirrored separately.
 *
 * The device is never requested here — callers pass the session device the
 * renderer registered (`getSessionGpuDevice()`), so there is exactly one
 * GPUDevice per session.
 */
import sweWgslSource from './swe.wgsl?raw';
import type { SweEventCall, SweSim, SweStepInput } from './sweSim';

const WORKGROUP = 64;
/** Matches MAX_EVENTS / EventBlock in swe.wgsl. */
export const WGSL_SWE_MAX_EVENTS_PER_DISPATCH = 32;
const EVENT_STRIDE_FLOATS = 8;
const PARAMS_BYTES = 48;

type EntryPoint = 'add_surface' | 'lift' | 'update' | 'apply_events';
const ENTRY_POINTS: readonly EntryPoint[] = ['add_surface', 'lift', 'update', 'apply_events'];

// WebGPU usage flags as literals: the GPUBufferUsage globals are absent under
// jsdom / Node, and these values are fixed by the spec.
const USAGE = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const;
const SHADER_STAGE_COMPUTE = 0x4;
const MAP_MODE_READ = 0x0001;

export interface WgslSweSim extends SweSim {
  readonly backend: 'wgsl';
  /** Authored events alone, no solver step (hydroContrast parity). */
  applyEvents(input: Omit<SweStepInput, 'dt' | 'g'>): void;
  /** Upload the whole CPU mirror (h, u, w, b) to the GPU field. */
  uploadField(): void;
  /** Resolves once the mirror reflects every step submitted so far. */
  flush(): Promise<void>;
}

/**
 * Build the pipelines and buffers. Rejects (instead of returning a half-built
 * sim) when the device refuses the shader or a pipeline, so the caller can
 * fall back to WASM before anything has stepped.
 */
export async function createWgslSweSim(
  device: GPUDevice,
  width: number,
  height: number,
  dx: number,
): Promise<WgslSweSim> {
  if (!(width > 0 && height > 0 && dx > 0)) {
    throw new Error(`WgslSweSim: invalid grid ${width}x${height} dx=${dx}`);
  }
  const count = width * height;

  device.pushErrorScope('validation');
  const module = device.createShaderModule({ label: 'swe.wgsl', code: sweWgslSource });
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'swe',
    entries: [
      { binding: 0, visibility: SHADER_STAGE_COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: SHADER_STAGE_COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: SHADER_STAGE_COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: SHADER_STAGE_COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: SHADER_STAGE_COMPUTE, buffer: { type: 'uniform' } },
    ],
  });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const pipelines = {} as Record<EntryPoint, GPUComputePipeline>;
  for (const entryPoint of ENTRY_POINTS) {
    pipelines[entryPoint] = device.createComputePipeline({
      label: `swe:${entryPoint}`,
      layout,
      compute: { module, entryPoint },
    });
  }
  const validation = await device.popErrorScope();
  if (validation) {
    throw new Error(`WgslSweSim: swe.wgsl rejected by the device: ${validation.message}`);
  }

  const fieldBytes = 4 * count * 4;
  const field = device.createBuffer({
    label: 'swe:field',
    size: fieldBytes,
    usage: USAGE.STORAGE | USAGE.COPY_SRC | USAGE.COPY_DST,
  });
  const scratch = device.createBuffer({
    label: 'swe:scratch',
    size: 3 * count * 4,
    usage: USAGE.STORAGE | USAGE.COPY_DST,
  });
  const maxBits = device.createBuffer({
    label: 'swe:maxBits',
    size: 4,
    usage: USAGE.STORAGE | USAGE.COPY_DST,
  });
  const staging = device.createBuffer({
    label: 'swe:staging',
    size: fieldBytes,
    usage: USAGE.MAP_READ | USAGE.COPY_DST,
  });

  // One params + events uniform pair per event chunk; chunk 0 also serves the
  // step itself. Grown on demand, reused across steps.
  const uniformSets: { params: GPUBuffer; events: GPUBuffer; bindGroup: GPUBindGroup }[] = [];
  const eventsBytes = WGSL_SWE_MAX_EVENTS_PER_DISPATCH * EVENT_STRIDE_FLOATS * 4;
  const uniformSet = (index: number) => {
    while (uniformSets.length <= index) {
      const params = device.createBuffer({
        label: `swe:params${uniformSets.length}`,
        size: PARAMS_BYTES,
        usage: USAGE.UNIFORM | USAGE.COPY_DST,
      });
      const events = device.createBuffer({
        label: `swe:events${uniformSets.length}`,
        size: eventsBytes,
        usage: USAGE.UNIFORM | USAGE.COPY_DST,
      });
      const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: field } },
          { binding: 2, resource: { buffer: scratch } },
          { binding: 3, resource: { buffer: maxBits } },
          { binding: 4, resource: { buffer: events } },
        ],
      });
      uniformSets.push({ params, events, bindGroup });
    }
    return uniformSets[index];
  };

  // CPU mirror, one allocation, SoA planes in the GPU field's layout.
  const mirror = new Float32Array(4 * count);
  const h = mirror.subarray(0, count);
  const u = mirror.subarray(count, 2 * count);
  const w = mirror.subarray(2 * count, 3 * count);
  const b = mirror.subarray(3 * count, 4 * count);
  const delta = new Float32Array(count);
  let deltaDirty = false;

  const paramsScratch = new ArrayBuffer(PARAMS_BYTES);
  const paramsU32 = new Uint32Array(paramsScratch);
  const paramsF32 = new Float32Array(paramsScratch);
  const eventsScratch = new ArrayBuffer(eventsBytes);
  const eventsI32 = new Int32Array(eventsScratch);
  const eventsF32 = new Float32Array(eventsScratch);

  const writeParams = (
    target: GPUBuffer,
    step: { dt: number; g: number; H: number; originX: number; originZ: number },
    eventCount: number,
  ) => {
    paramsU32[0] = width;
    paramsU32[1] = height;
    paramsU32[2] = count;
    paramsU32[3] = eventCount;
    paramsF32[4] = step.dt;
    paramsF32[5] = step.g;
    paramsF32[6] = dx;
    paramsF32[7] = step.H;
    paramsF32[8] = step.originX;
    paramsF32[9] = step.originZ;
    paramsF32[10] = 0;
    paramsF32[11] = 0;
    device.queue.writeBuffer(target, 0, paramsScratch);
  };

  const writeEvents = (target: GPUBuffer, chunk: readonly SweEventCall[]) => {
    eventsF32.fill(0);
    chunk.forEach((e, k) => {
      const o = k * EVENT_STRIDE_FLOATS;
      eventsI32[o] = e.kind | 0;
      eventsF32[o + 1] = e.cx;
      eventsF32[o + 2] = e.cz;
      eventsF32[o + 3] = e.radius;
      eventsF32[o + 4] = e.strength;
      eventsF32[o + 5] = e.dt;
    });
    device.queue.writeBuffer(target, 0, eventsScratch);
  };

  const groups = Math.ceil(count / WORKGROUP);
  let fieldVersion = 0;
  let disposed = false;
  let readbackPending: Promise<void> | null = null;
  /** Steps submitted but not yet covered by a completed readback. */
  let unmirrored = false;

  const startReadback = () => {
    const encoder = device.createCommandEncoder({ label: 'swe:readback' });
    encoder.copyBufferToBuffer(field, 0, staging, 0, fieldBytes);
    device.queue.submit([encoder.finish()]);
    unmirrored = false;
    readbackPending = staging
      .mapAsync(MAP_MODE_READ)
      .then(() => {
        if (disposed) return;
        mirror.set(new Float32Array(staging.getMappedRange()));
        staging.unmap();
        fieldVersion += 1;
      })
      .catch((error: unknown) => {
        if (!disposed) console.warn('[WgslSweSim] readback failed', error);
      })
      .finally(() => {
        readbackPending = null;
      });
  };

  /** Upload params for every event chunk; chunk 0's set also serves the solver passes. */
  const prepareUniforms = (input: SweStepInput): number => {
    const events = input.events;
    const chunks = Math.max(1, Math.ceil(events.length / WGSL_SWE_MAX_EVENTS_PER_DISPATCH));
    for (let c = 0; c < chunks; c += 1) {
      const chunk = events.slice(c * WGSL_SWE_MAX_EVENTS_PER_DISPATCH, (c + 1) * WGSL_SWE_MAX_EVENTS_PER_DISPATCH);
      const set = uniformSet(c);
      writeParams(set.params, input, chunk.length);
      if (chunk.length > 0) writeEvents(set.events, chunk);
    }
    return chunks;
  };

  const encodeEvents = (encoder: GPUCommandEncoder, eventCount: number, chunks: number) => {
    if (eventCount === 0) return;
    for (let c = 0; c < chunks; c += 1) {
      const pass = encoder.beginComputePass({ label: 'swe:apply_events' });
      pass.setPipeline(pipelines.apply_events);
      pass.setBindGroup(0, uniformSet(c).bindGroup);
      pass.dispatchWorkgroups(groups);
      pass.end();
    }
  };

  const submit = (encoder: GPUCommandEncoder) => {
    device.queue.submit([encoder.finish()]);
    unmirrored = true;
    if (!readbackPending) startReadback();
  };

  const sim: WgslSweSim = {
    backend: 'wgsl',
    width,
    height,
    dx,
    h,
    u,
    w,
    b,
    get fieldVersion() {
      return fieldVersion;
    },
    uploadField() {
      device.queue.writeBuffer(field, 0, mirror);
    },
    commitBed() {
      device.queue.writeBuffer(field, 3 * count * 4, b);
    },
    addSurface(index, amount) {
      if (index < 0 || index >= count) return;
      delta[index] += amount;
      deltaDirty = true;
    },
    step(input: SweStepInput) {
      if (disposed) return;
      const chunks = prepareUniforms(input);
      const main = uniformSet(0);

      const encoder = device.createCommandEncoder({ label: 'swe:step' });
      if (deltaDirty) {
        device.queue.writeBuffer(scratch, 0, delta);
        delta.fill(0);
        deltaDirty = false;
        const pass = encoder.beginComputePass({ label: 'swe:add_surface' });
        pass.setPipeline(pipelines.add_surface);
        pass.setBindGroup(0, main.bindGroup);
        pass.dispatchWorkgroups(groups);
        pass.end();
      }
      encoder.clearBuffer(maxBits);
      // Separate passes: each dispatch must see the previous one's writes.
      for (const entry of ['lift', 'update'] as const) {
        const pass = encoder.beginComputePass({ label: `swe:${entry}` });
        pass.setPipeline(pipelines[entry]);
        pass.setBindGroup(0, main.bindGroup);
        pass.dispatchWorkgroups(groups);
        pass.end();
      }
      encodeEvents(encoder, input.events.length, chunks);
      submit(encoder);
    },
    applyEvents(input) {
      if (disposed || input.events.length === 0) return;
      const chunks = prepareUniforms({ ...input, dt: 0, g: 0 });
      const encoder = device.createCommandEncoder({ label: 'swe:events' });
      encodeEvents(encoder, input.events.length, chunks);
      submit(encoder);
    },
    async flush() {
      while (!disposed && (readbackPending || unmirrored)) {
        if (readbackPending) {
          await readbackPending;
        } else {
          startReadback();
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const destroy = () => {
        for (const buffer of [field, scratch, maxBits, staging]) buffer.destroy();
        for (const set of uniformSets) {
          set.params.destroy();
          set.events.destroy();
        }
      };
      // Destroying a buffer mid-map rejects the map; let it settle first.
      if (readbackPending) void readbackPending.finally(destroy);
      else destroy();
    },
  };

  return sim;
}
