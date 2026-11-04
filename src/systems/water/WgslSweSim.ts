/**
 * WgslSweSim — the WGSL twin of the C++ SWE stepper (#435), on the renderer's
 * own GPUDevice.
 *
 * Numerics live in `swe.wgsl` (a line-for-line port of emscripten/swe.cpp,
 * ABI 17: the sub-cycled step with or without the routed upstream edge,
 * applySWEEvent, scrollShallowWater, and chores.cpp packSurfaceField). This
 * file owns buffers, dispatch order, and the CPU mirror:
 *
 *   step():  write clock {max 0, remaining dt} → [upload splash delta →
 *            add_surface] → 4 × (lift → update → advance_clock) → settle_clock
 *            → apply_events (32 per dispatch)
 *   readback: pack_surface (field → RGBA flow plane in scratch) → copy field,
 *            the plane and the clock → staging; then zero the clock's `owed`.
 *   An async map of the staging buffer refreshes h/u/w/b and the flow plane
 *   (`packSurface`) and bumps `fieldVersion`. At most one readback is in
 *   flight; a step that lands while one is pending still runs on the GPU, it
 *   just is not mirrored separately — the next readback covers it.
 *
 * Sub-cycling (#533). The C++ loops up to kMaxSubsteps CFL steps until `dt`
 * is integrated. The host cannot see the wave-speed max without a readback,
 * so all four sub-steps are encoded every step and the time still to
 * integrate lives on the GPU (`Clock.remaining` in swe.wgsl); sub-steps past
 * the end are no-ops. All of a step's solver dispatches share one compute
 * pass — each dispatch is its own WebGPU usage scope, so it sees the
 * previous dispatch's storage writes.
 *
 * Shortfall. What the cap left over (`remaining` after the fourth sub-step)
 * is added by `settle_clock` to `Clock.owed` on the GPU. Each readback copies
 * `owed` in the same command buffer as the field, and a queue.writeBuffer
 * right after that submit zeroes it. Queue order puts every step's settle
 * either before the copy (counted by this readback) or after the zeroing
 * (counted by the next), so each step's shortfall is counted exactly once —
 * including steps that landed while a readback was pending, and readbacks
 * discarded by a scroll (time is not tied to the index frame). Small
 * per-readback sums, not a session-long running total, so f32 never has to
 * difference two large numbers. The host adds `dt − fround(dt)` itself (the
 * GPU integrates the f32 dt, as the C++ does), plus all of `dt` for a step
 * the C++ would reject (non-finite or non-positive g / H), which runs no
 * solver here either. It therefore arrives a readback late (sweSim.ts).
 *
 *   scroll(): [splash delta → add_surface] → scroll (gather into scratch) →
 *             copy scratch → field, and the same shift applied to the CPU mirror
 *             so every reader stays in the new index frame at once. A readback
 *             that was already in flight was taken in the OLD frame, so it is
 *             discarded on landing rather than dragged across the scroll — the
 *             next step's readback replaces it. Readers therefore never pair a
 *             stale-frame field with the new window origin.
 *
 * The device is never requested here — callers pass the session device the
 * renderer registered (`getSessionGpuDevice()`), so there is exactly one
 * GPUDevice per session.
 */
import sweWgslSource from './swe.wgsl?raw';
import type { SweEventCall, SweSim, SweStepInput } from './sweSim';
import { SWE_REST_INFLOW, scrollField, scrollTexels, type SweInflow } from './sweScroll';
import { SWE_FLOW_CHANNELS } from './sweSurfaceField';

const WORKGROUP = 64;
/** Matches MAX_EVENTS / EventBlock in swe.wgsl. */
export const WGSL_SWE_MAX_EVENTS_PER_DISPATCH = 32;
/** CFL sub-steps encoded per step — kMaxSubsteps in swe.cpp (pinned by sweConstants.drift.test.ts). */
export const WGSL_SWE_MAX_SUBSTEPS = 4;
const EVENT_STRIDE_FLOATS = 8;
const PARAMS_BYTES = 80;
/** `Clock` in swe.wgsl: maxSpeedBits u32 @0, remaining f32 @4, owed f32 @8, pad @12. */
const CLOCK_BYTES = 16;
const CLOCK_OWED_BYTE = 8;
const CLOCK_OWED_FLOAT = CLOCK_OWED_BYTE / 4;

type EntryPoint =
  | 'add_surface'
  | 'lift'
  | 'update'
  | 'advance_clock'
  | 'settle_clock'
  | 'apply_events'
  | 'pack_surface'
  | 'scroll';
const ENTRY_POINTS: readonly EntryPoint[] = [
  'add_surface',
  'lift',
  'update',
  'advance_clock',
  'settle_clock',
  'apply_events',
  'pack_surface',
  'scroll',
];

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
  // 4 planes: (d, d·u, d·w) for a step, a gathered copy of h/u/w/b for a
  // scroll (copied back over `field`), and the RGBA flow plane for a readback
  // (copied to staging) — COPY_SRC for both.
  const scratch = device.createBuffer({
    label: 'swe:scratch',
    size: 4 * count * 4,
    usage: USAGE.STORAGE | USAGE.COPY_SRC | USAGE.COPY_DST,
  });
  // Zero-initialised: remaining 0 (no step in progress), owed 0.
  const clock = device.createBuffer({
    label: 'swe:clock',
    size: CLOCK_BYTES,
    usage: USAGE.STORAGE | USAGE.COPY_SRC | USAGE.COPY_DST,
  });
  // [field 4N | flow plane 4N | clock] — one map per readback.
  const surfaceBytes = SWE_FLOW_CHANNELS * count * 4;
  const stagingBytes = fieldBytes + surfaceBytes + CLOCK_BYTES;
  const staging = device.createBuffer({
    label: 'swe:staging',
    size: stagingBytes,
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
          { binding: 3, resource: { buffer: clock } },
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
  // The flow texture's backing store: the plane the GPU packed with the last
  // landed readback, moved with the mirror on scroll. All zeros (dry) until the
  // first readback lands — as on wasm-worker, nothing packs it on this thread.
  const surface = new Float32Array(SWE_FLOW_CHANNELS * count);
  /**
   * meanDepth for the GPU packing: the H of the latest step / applyEvents, or
   * before either ran, the meanDepth a packSurface call asked for.
   */
  let packDepth: number | null = null;
  /** Host half of the shortfall (see the header); the GPU half lands with readbacks. */
  let shortfall = 0;
  const clockSeed = new ArrayBuffer(8);
  const clockSeedF32 = new Float32Array(clockSeed);
  const zeroWord = new Float32Array(1);

  const paramsScratch = new ArrayBuffer(PARAMS_BYTES);
  const paramsU32 = new Uint32Array(paramsScratch);
  const paramsI32 = new Int32Array(paramsScratch);
  const paramsF32 = new Float32Array(paramsScratch);
  const eventsScratch = new ArrayBuffer(eventsBytes);
  const eventsI32 = new Int32Array(eventsScratch);
  const eventsF32 = new Float32Array(eventsScratch);

  const writeParams = (
    target: GPUBuffer,
    step: { dt: number; g: number; H: number; originX: number; originZ: number; edgeEta?: number },
    eventCount: number,
    scrollBy?: { shiftX: number; shiftZ: number; inflow: SweInflow },
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
    paramsI32[10] = scrollBy?.shiftX ?? 0;
    paramsI32[11] = scrollBy?.shiftZ ?? 0;
    paramsF32[12] = scrollBy?.inflow.eta ?? 0;
    paramsF32[13] = scrollBy?.inflow.u ?? 0;
    paramsF32[14] = scrollBy?.inflow.w ?? 0;
    paramsF32[15] = 0;
    paramsU32[16] = step.edgeEta === undefined ? 0 : 1;
    paramsF32[17] = step.edgeEta ?? 0;
    paramsF32[18] = 0;
    paramsF32[19] = 0;
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
  // Its own params: uniform set 0's are rewritten by scroll (H 0) and steps.
  const packSet = (() => {
    const params = device.createBuffer({
      label: 'swe:packParams',
      size: PARAMS_BYTES,
      usage: USAGE.UNIFORM | USAGE.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: field } },
        { binding: 2, resource: { buffer: scratch } },
        { binding: 3, resource: { buffer: clock } },
        { binding: 4, resource: { buffer: uniformSet(0).events } },
      ],
    });
    return { params, bindGroup };
  })();
  let fieldVersion = 0;
  let disposed = false;
  let readbackPending: Promise<void> | null = null;
  /** Steps submitted but not yet covered by a completed readback. */
  let unmirrored = false;
  /** Bumped by every scroll; a readback taken in an older frame is not mirrored. */
  let scrollEpoch = 0;

  const startReadback = () => {
    // Pack the flow plane from the field as it is now — after the last step's
    // events, any applyEvents and any scroll — so it always describes the
    // field this same readback copies. scratch is free between submits.
    writeParams(packSet.params, { dt: 0, g: 0, H: packDepth ?? 0, originX: 0, originZ: 0 }, 0);
    const encoder = device.createCommandEncoder({ label: 'swe:readback' });
    const pass = encoder.beginComputePass({ label: 'swe:pack_surface' });
    pass.setPipeline(pipelines.pack_surface);
    pass.setBindGroup(0, packSet.bindGroup);
    pass.dispatchWorkgroups(groups);
    pass.end();
    encoder.copyBufferToBuffer(field, 0, staging, 0, fieldBytes);
    encoder.copyBufferToBuffer(scratch, 0, staging, fieldBytes, surfaceBytes);
    encoder.copyBufferToBuffer(clock, 0, staging, fieldBytes + surfaceBytes, CLOCK_BYTES);
    device.queue.submit([encoder.finish()]);
    // Ordered after that copy and before any later step's settle_clock: every
    // step's shortfall is in exactly one readback (see the header).
    device.queue.writeBuffer(clock, CLOCK_OWED_BYTE, zeroWord);
    unmirrored = false;
    const epoch = scrollEpoch;
    readbackPending = staging
      .mapAsync(MAP_MODE_READ)
      .then(() => {
        if (disposed) return;
        const staged = new Float32Array(staging.getMappedRange());
        // Owed time is not tied to the index frame: counted even when the
        // field itself is discarded below.
        const owed = staged[2 * 4 * count + CLOCK_OWED_FLOAT];
        if (owed > 0) shortfall += owed;
        // A scroll landed after this copy: the data is in the old index frame.
        // The mirror (and its flow plane) was already scrolled on the CPU; keep
        // it, and let the next readback (which `unmirrored` guarantees) bring
        // the GPU truth.
        if (epoch === scrollEpoch) {
          mirror.set(staged.subarray(0, 4 * count));
          surface.set(staged.subarray(4 * count, 8 * count));
          fieldVersion += 1;
        }
        staging.unmap();
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

  /** Fold queued splash deltas into η — they are addressed in the current frame. */
  const encodeAddSurface = (encoder: GPUCommandEncoder) => {
    if (!deltaDirty) return;
    device.queue.writeBuffer(scratch, 0, delta);
    delta.fill(0);
    deltaDirty = false;
    const pass = encoder.beginComputePass({ label: 'swe:add_surface' });
    pass.setPipeline(pipelines.add_surface);
    pass.setBindGroup(0, uniformSet(0).bindGroup);
    pass.dispatchWorkgroups(groups);
    pass.end();
  };

  /**
   * 4 × (lift → update → advance_clock), then settle_clock, in one pass: each
   * dispatch is a usage scope of its own, so it sees the previous one's writes.
   */
  const encodeSolver = (encoder: GPUCommandEncoder, bindGroup: GPUBindGroup) => {
    const pass = encoder.beginComputePass({ label: 'swe:solve' });
    pass.setBindGroup(0, bindGroup);
    for (let k = 0; k < WGSL_SWE_MAX_SUBSTEPS; k += 1) {
      pass.setPipeline(pipelines.lift);
      pass.dispatchWorkgroups(groups);
      pass.setPipeline(pipelines.update);
      pass.dispatchWorkgroups(groups);
      pass.setPipeline(pipelines.advance_clock);
      pass.dispatchWorkgroups(1);
    }
    pass.setPipeline(pipelines.settle_clock);
    pass.dispatchWorkgroups(1);
    pass.end();
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
      // One NaN here would spread through η (#533): drop it at the door.
      if (!Number.isInteger(index) || index < 0 || index >= count || !Number.isFinite(amount)) return;
      delta[index] += amount;
      deltaDirty = true;
    },
    scroll(shiftX, shiftZ, inflow = SWE_REST_INFLOW) {
      if (disposed) return;
      if (!Number.isFinite(shiftX) || !Number.isFinite(shiftZ)) return;
      const sx = Math.max(-width, Math.min(width, Math.trunc(shiftX)));
      const sz = Math.max(-height, Math.min(height, Math.trunc(shiftZ)));
      if (sx === 0 && sz === 0) return;

      writeParams(
        uniformSet(0).params,
        { dt: 0, g: 0, H: 0, originX: 0, originZ: 0 },
        0,
        { shiftX: sx, shiftZ: sz, inflow },
      );
      const encoder = device.createCommandEncoder({ label: 'swe:scroll' });
      encodeAddSurface(encoder);
      const pass = encoder.beginComputePass({ label: 'swe:scroll' });
      pass.setPipeline(pipelines.scroll);
      pass.setBindGroup(0, uniformSet(0).bindGroup);
      pass.dispatchWorkgroups(groups);
      pass.end();
      encoder.copyBufferToBuffer(scratch, 0, field, 0, fieldBytes);
      device.queue.submit([encoder.finish()]);

      // Same shift on the CPU mirror, so readers move to the new frame in step
      // with the window origin. No readback is started here: the next step's
      // readback follows the bed commit and picks up the GPU truth.
      scrollField({ h, u, w, b }, width, height, sx, sz, inflow);
      // The flow plane moves with it (entering cells take their nearest
      // texel) until the next readback replaces all of it.
      scrollTexels(surface, width, height, SWE_FLOW_CHANNELS, sx, sz);
      scrollEpoch += 1;
      unmirrored = true;
      fieldVersion += 1;
    },
    step(input: SweStepInput) {
      if (disposed) return;
      const { dt, g, H } = input;
      // swe.cpp's gate: dt finite and > 0, else no solver step (and, as on
      // wasm-main, no shortfall — events carry their own dt). g and H must be
      // finite and > 0 too; the C++ rejects such a step, integrating nothing,
      // so all of dt is owed. A non-finite edge stage is the reference (0).
      const solve = Number.isFinite(dt) && dt > 0;
      const accepted = solve && Number.isFinite(g) && g > 0 && Number.isFinite(H) && H > 0;
      if (solve && !accepted) shortfall += dt;
      if (Number.isFinite(H)) packDepth = H;
      const edgeEta = input.edgeEta === undefined ? undefined : Number.isFinite(input.edgeEta) ? input.edgeEta : 0;
      const chunks = prepareUniforms({ ...input, dt: accepted ? dt : 0, edgeEta });
      const main = uniformSet(0);

      if (accepted) {
        // The GPU integrates fround(dt) and reports what the cap left of that;
        // the rounding itself is owed here, as wasm-main's dt − integrated is.
        shortfall += Math.max(0, dt - Math.fround(dt));
        // {max 0, remaining dt}: ordered after every earlier submit (whose
        // settle_clock left remaining 0) and before this one.
        clockSeedF32[0] = 0;
        clockSeedF32[1] = dt;
        device.queue.writeBuffer(clock, 0, clockSeed);
      }

      const encoder = device.createCommandEncoder({ label: 'swe:step' });
      encodeAddSurface(encoder);
      if (accepted) encodeSolver(encoder, main.bindGroup);
      encodeEvents(encoder, input.events.length, chunks);
      submit(encoder);
    },
    takeShortfall() {
      const owed = shortfall;
      shortfall = 0;
      return owed;
    },
    packSurface(meanDepth) {
      // The plane that arrived with the field at `fieldVersion`, packed on the
      // GPU with the latest step's H. meanDepth only seeds that depth for
      // readbacks taken before any step / applyEvents supplied an H.
      if (packDepth === null && Number.isFinite(meanDepth)) packDepth = meanDepth;
      return surface;
    },
    applyEvents(input) {
      if (disposed || input.events.length === 0) return;
      if (Number.isFinite(input.H)) packDepth = input.H;
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
        for (const buffer of [field, scratch, clock, staging, packSet.params]) buffer.destroy();
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
