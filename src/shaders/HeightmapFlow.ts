import * as THREE from 'three';

export interface HeightmapFlowOptions {
  size?: number;
  shaderUrl?: string;
  flowStrength?: number;
  viscosity?: number;
  normalStrength?: number;
  gravity?: number;
}

export interface HeightmapFlowUpdateOptions {
  flowStrength?: number;
  viscosity?: number;
  normalStrength?: number;
  gravity?: number;
}

type GpuState = {
  device: GPUDevice;
  pipeline: GPUComputePipeline;
  bindGroups: GPUBindGroup[];
  uniformBuffer: GPUBuffer;
  heightTextures: GPUTexture[];
  flowTextures: GPUTexture[];
  readIndex: number;
};

const DEFAULT_SIZE = 128;
const DEFAULT_SHADER_URL = '/shaders/heightmap_flow.wgsl';
const UNIFORM_FLOATS = 8;

function createInitialFlowData(size: number): Float32Array {
  const data = new Float32Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const nx = x / Math.max(1, size - 1);
      const ny = y / Math.max(1, size - 1);
      const riffle = Math.sin(nx * Math.PI * 6) * Math.cos(ny * Math.PI * 4) * 0.04;
      data[index] = 0.5 + riffle;
      data[index + 1] = 0.5;
      data[index + 2] = 0.0;
      data[index + 3] = 1.0;
    }
  }
  return data;
}

function createDataTexture(size: number, data: Float32Array): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    data as unknown as BufferSource,
    size,
    size,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class HeightmapFlowController {
  readonly size: number;
  readonly flowMapTexture: THREE.DataTexture;
  readonly heightNormalTexture: THREE.DataTexture;

  private shaderUrl: string;
  private params: Required<Omit<HeightmapFlowOptions, 'size' | 'shaderUrl'>>;
  private flowData: Float32Array;
  private heightData: Float32Array;
  private gpuState: GpuState | null = null;
  private gpuInit: Promise<void> | null = null;
  private frameCount = 0;
  private totalComputeMs = 0;
  private lastLogFrame = 0;

  constructor(options: HeightmapFlowOptions = {}) {
    this.size = options.size ?? DEFAULT_SIZE;
    this.shaderUrl = options.shaderUrl ?? DEFAULT_SHADER_URL;
    this.params = {
      flowStrength: options.flowStrength ?? 1.0,
      viscosity: options.viscosity ?? 0.08,
      normalStrength: options.normalStrength ?? 2.0,
      gravity: options.gravity ?? 9.8,
    };

    this.heightData = createInitialFlowData(this.size);
    this.flowData = createInitialFlowData(this.size);
    this.heightNormalTexture = createDataTexture(this.size, this.heightData);
    this.flowMapTexture = createDataTexture(this.size, this.flowData);
  }

  get averageComputeMs(): number {
    return this.frameCount > 0 ? this.totalComputeMs / this.frameCount : 0;
  }

  async initWebGPU(): Promise<void> {
    if (this.gpuInit) return this.gpuInit;
    this.gpuInit = this.createGpuState();
    return this.gpuInit;
  }

  update(deltaTime: number, elapsedTime: number, options: HeightmapFlowUpdateOptions = {}): void {
    this.params = { ...this.params, ...options };

    const start = performance.now();
    if (this.gpuState) {
      this.dispatchGpu(deltaTime, elapsedTime);
    } else {
      this.updateCpuFallback(deltaTime, elapsedTime);
    }

    this.frameCount += 1;
    this.totalComputeMs += performance.now() - start;
    if (this.frameCount - this.lastLogFrame >= 120) {
      this.lastLogFrame = this.frameCount;
      console.log(`[HeightmapFlow] avg compute ${this.averageComputeMs.toFixed(3)}ms (${this.gpuState ? 'WebGPU' : 'DataTexture'})`);
    }
  }

  dispose(): void {
    this.flowMapTexture.dispose();
    this.heightNormalTexture.dispose();
    if (this.gpuState) {
      this.gpuState.uniformBuffer.destroy();
      this.gpuState.heightTextures.forEach((texture) => texture.destroy());
      this.gpuState.flowTextures.forEach((texture) => texture.destroy());
    }
    this.gpuState = null;
  }

  private async createGpuState(): Promise<void> {
    if (!('gpu' in navigator) || !navigator.gpu) return;

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return;

    const device = await adapter.requestDevice();
    const source = await fetch(this.shaderUrl).then((response) => response.text());
    const module = device.createShaderModule({ code: source });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });

    const textureDescriptor: GPUTextureDescriptor = {
      size: [this.size, this.size],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
    };

    const heightTextures = [
      device.createTexture(textureDescriptor),
      device.createTexture(textureDescriptor),
    ];
    const flowTextures = [
      device.createTexture(textureDescriptor),
      device.createTexture(textureDescriptor),
    ];

    const uniformBuffer = device.createBuffer({
      size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeTexture(
      { texture: heightTextures[0] },
      this.heightData as unknown as GPUAllowSharedBufferSource,
      { bytesPerRow: this.size * 16 },
      [this.size, this.size],
    );
    device.queue.writeTexture(
      { texture: flowTextures[0] },
      this.flowData as unknown as GPUAllowSharedBufferSource,
      { bytesPerRow: this.size * 16 },
      [this.size, this.size],
    );

    const bindGroups = [0, 1].map((readIndex) => pipeline.getBindGroupLayout(0)).map((layout, readIndex) => {
      const writeIndex = 1 - readIndex;
      return device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: heightTextures[readIndex].createView() },
          { binding: 2, resource: flowTextures[readIndex].createView() },
          { binding: 3, resource: heightTextures[writeIndex].createView() },
          { binding: 4, resource: flowTextures[writeIndex].createView() },
        ],
      });
    });

    this.gpuState = {
      device,
      pipeline,
      bindGroups,
      uniformBuffer,
      heightTextures,
      flowTextures,
      readIndex: 0,
    };
  }

  private dispatchGpu(deltaTime: number, elapsedTime: number): void {
    const gpu = this.gpuState;
    if (!gpu) return;

    this.writeUniforms(gpu.device, gpu.uniformBuffer, deltaTime, elapsedTime);

    const encoder = gpu.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(gpu.pipeline);
    pass.setBindGroup(0, gpu.bindGroups[gpu.readIndex]);
    pass.dispatchWorkgroups(Math.ceil(this.size / 8), Math.ceil(this.size / 8));
    pass.end();
    gpu.device.queue.submit([encoder.finish()]);
    gpu.readIndex = 1 - gpu.readIndex;
  }

  private writeUniforms(device: GPUDevice, buffer: GPUBuffer, deltaTime: number, elapsedTime: number): void {
    const values = new Float32Array(UNIFORM_FLOATS);
    values[0] = 1 / this.size;
    values[1] = 1 / this.size;
    values[2] = Math.min(deltaTime, 1 / 20);
    values[3] = this.params.flowStrength;
    values[4] = this.params.viscosity;
    values[5] = this.params.normalStrength;
    values[6] = this.params.gravity;
    values[7] = elapsedTime;
    device.queue.writeBuffer(buffer, 0, values);
  }

  private updateCpuFallback(deltaTime: number, elapsedTime: number): void {
    const flow = this.flowData;
    const height = this.heightData;
    const size = this.size;
    const dt = Math.min(deltaTime, 1 / 20);
    const flowStrength = this.params.flowStrength;
    const viscosity = this.params.viscosity;

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const index = (y * size + x) * 4;
        const phase = elapsedTime * flowStrength + x * 0.08 + y * 0.05;
        const lateral = Math.sin(phase) * 0.08 * flowStrength;
        const downstream = -0.5 + Math.cos(phase * 0.73) * 0.05;
        flow[index] = THREE.MathUtils.clamp(0.5 + lateral, 0, 1);
        flow[index + 1] = THREE.MathUtils.clamp(0.5 + downstream * (1 - viscosity * dt), 0, 1);
        flow[index + 2] = Math.abs(downstream);
        flow[index + 3] = 1;
        height[index] = THREE.MathUtils.clamp(height[index] + Math.sin(phase * 0.9) * 0.0008, 0, 1);
        height[index + 1] = 0.5;
        height[index + 2] = 1.0;
        height[index + 3] = 0.5;
      }
    }

    this.flowMapTexture.needsUpdate = true;
    this.heightNormalTexture.needsUpdate = true;
  }
}

export function createHeightmapFlowController(options?: HeightmapFlowOptions): HeightmapFlowController {
  return new HeightmapFlowController(options);
}
