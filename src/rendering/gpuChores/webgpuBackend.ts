/**
 * `gpu-chores` WebGPU lane. Adopts a session GPUDevice — never requestDevice().
 *
 * `canRun` requires a GPUTexture source. CPU Float32Array jobs stay on wasm/ts
 * so we do not upload SWE's already-resident heap view just to reduce it.
 */

import { BLUR_H_WGSL, DOWNSAMPLE_WGSL, HISTOGRAM_WGSL, REDUCE_WGSL } from './kernels.wgsl';
import {
  canAnalyzeTexture,
  detectGpuComputeSupport,
  isGpuComputeDisabledByFlag,
  type GpuComputeSupport,
} from './support';
import { HISTOGRAM_BINS, type ChoreBackend, type ChoreBackendImpl, type ChoreJob, type ChoreOutput } from './types';

function createPipeline(device: GPUDevice, code: string): GPUComputePipeline {
  const module = device.createShaderModule({ code });
  return device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
}

async function readbackF32(device: GPUDevice, src: GPUBuffer, floatCount: number): Promise<Float32Array> {
  const bytes = floatCount * 4;
  const staging = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(src, 0, staging, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const data = new Float32Array(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  return data;
}

async function readbackU32(device: GPUDevice, src: GPUBuffer, count: number): Promise<Uint32Array> {
  const bytes = count * 4;
  const staging = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(src, 0, staging, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const data = new Uint32Array(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  return data;
}

export class WebGpuChoreBackend implements ChoreBackendImpl {
  readonly backend: ChoreBackend = 'webgpu';

  private readonly device: GPUDevice;
  private readonly support: GpuComputeSupport;
  private reducePipeline: GPUComputePipeline | null = null;
  private histPipeline: GPUComputePipeline | null = null;
  private downsamplePipeline: GPUComputePipeline | null = null;
  private blurPipeline: GPUComputePipeline | null = null;

  constructor(device: GPUDevice) {
    this.device = device;
    this.support = detectGpuComputeSupport(device);
  }

  canRun(job: ChoreJob): boolean {
    if (isGpuComputeDisabledByFlag()) return false;
    if (!this.support.available) return false;
    if (!job.source) return false;
    return canAnalyzeTexture(this.support, job.width, job.height);
  }

  declineReason(job: ChoreJob): string {
    if (isGpuComputeDisabledByFlag()) return this.support.reason ?? 'Disabled by ?no_gpu_compute';
    if (!this.support.available) return this.support.reason ?? 'WebGPU compute unavailable';
    if (!job.source) return 'No GPU texture source';
    if (!canAnalyzeTexture(this.support, job.width, job.height)) {
      return 'Texture exceeds device maxTextureDimension2D';
    }
    return 'Unavailable';
  }

  async run(job: ChoreJob): Promise<ChoreOutput | null> {
    if (!this.canRun(job) || !job.source) return null;
    switch (job.op) {
      case 'grid-reduce':
        return this.runReduce(job.source, job.width, job.height);
      case 'luma-histogram':
        return this.runHistogram(job.source, job.width, job.height, job.rangeMin, job.rangeMax);
      case 'downsample-2d':
        return this.runDownsample(job.source, job.width, job.height, job.destWidth, job.destHeight);
      case 'separable-blur':
        return this.runBlur(job.source, job.width, job.height);
      default:
        return null;
    }
  }

  destroy(): void {
    this.reducePipeline = null;
    this.histPipeline = null;
    this.downsamplePipeline = null;
    this.blurPipeline = null;
  }

  private pipeline(kind: 'reduce' | 'hist' | 'down' | 'blur'): GPUComputePipeline {
    if (kind === 'reduce') {
      this.reducePipeline ??= createPipeline(this.device, REDUCE_WGSL);
      return this.reducePipeline;
    }
    if (kind === 'hist') {
      this.histPipeline ??= createPipeline(this.device, HISTOGRAM_WGSL);
      return this.histPipeline;
    }
    if (kind === 'down') {
      this.downsamplePipeline ??= createPipeline(this.device, DOWNSAMPLE_WGSL);
      return this.downsamplePipeline;
    }
    this.blurPipeline ??= createPipeline(this.device, BLUR_H_WGSL);
    return this.blurPipeline;
  }

  private async runReduce(source: GPUTexture, width: number, height: number): Promise<ChoreOutput> {
    const pipeline = this.pipeline('reduce');
    const outBuf = this.device.createBuffer({
      size: 12,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const uniform = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(uniform, 0, new Uint32Array([width, height, 0, 0]));
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: { buffer: outBuf } },
        { binding: 2, resource: { buffer: uniform } },
      ],
    });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    const data = await readbackF32(this.device, outBuf, 3);
    outBuf.destroy();
    uniform.destroy();
    return {
      kind: 'grid-reduce',
      min: data[0],
      max: data[1],
      mean: data[2],
      count: width * height,
    };
  }

  private async runHistogram(
    source: GPUTexture,
    width: number,
    height: number,
    rangeMin?: number,
    rangeMax?: number,
  ): Promise<ChoreOutput> {
    const pipeline = this.pipeline('hist');
    const binsBuf = this.device.createBuffer({
      size: HISTOGRAM_BINS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(binsBuf, 0, new Uint32Array(HISTOGRAM_BINS));
    const uniform = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const u32 = new Uint32Array([width, height, 0, 0]);
    const f32 = new Float32Array(u32.buffer);
    f32[2] = rangeMin ?? 0;
    f32[3] = rangeMax ?? 1;
    this.device.queue.writeBuffer(uniform, 0, u32);
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: { buffer: binsBuf } },
        { binding: 2, resource: { buffer: uniform } },
      ],
    });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    const bins = await readbackU32(this.device, binsBuf, HISTOGRAM_BINS);
    binsBuf.destroy();
    uniform.destroy();
    let count = 0;
    for (let i = 0; i < bins.length; i += 1) count += bins[i];
    return { kind: 'luma-histogram', bins, count };
  }

  private async runDownsample(
    source: GPUTexture,
    srcW: number,
    srcH: number,
    destW: number,
    destH: number,
  ): Promise<ChoreOutput> {
    const pipeline = this.pipeline('down');
    const destCount = destW * destH;
    const destBuf = this.device.createBuffer({
      size: destCount * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const uniform = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(uniform, 0, new Uint32Array([srcW, srcH, destW, destH]));
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: { buffer: destBuf } },
        { binding: 2, resource: { buffer: uniform } },
      ],
    });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(destW / 8), Math.ceil(destH / 8));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    const values = await readbackF32(this.device, destBuf, destCount);
    destBuf.destroy();
    uniform.destroy();
    return { kind: 'downsample-2d', values, width: destW, height: destH };
  }

  private async runBlur(source: GPUTexture, width: number, height: number): Promise<ChoreOutput> {
    const pipeline = this.pipeline('blur');
    const destBuf = this.device.createBuffer({
      size: width * height * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const uniform = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(uniform, 0, new Uint32Array([width, height, 0, 0]));
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: { buffer: destBuf } },
        { binding: 2, resource: { buffer: uniform } },
      ],
    });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    const values = await readbackF32(this.device, destBuf, width * height);
    destBuf.destroy();
    uniform.destroy();
    return { kind: 'separable-blur', values, width, height };
  }
}
