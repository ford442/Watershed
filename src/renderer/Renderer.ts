import { mat4, vec3 } from 'gl-matrix';
import { Camera } from './Camera';
import { Geometry, Mesh } from './Geometry';
import { InputHandler } from './InputHandler';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private format!: GPUTextureFormat;

    private camera: Camera;
    private inputHandler: InputHandler;

    private ready = false;

    // Pipelines
    private skyPipeline!: GPURenderPipeline;
    private terrainPipeline!: GPURenderPipeline;
    private treeTrunkPipeline!: GPURenderPipeline;
    private treeLeavesPipeline!: GPURenderPipeline;
    private waterPipeline!: GPURenderPipeline;

    // Resources
    private depthTexture!: GPUTexture;
    private globalUniformBuffer!: GPUBuffer;
    private instanceBuffer!: GPUBuffer; // Tree positions

    // Textures
    private skyTexture!: GPUTexture;
    private groundTexture!: GPUTexture;
    private barkTexture!: GPUTexture;
    private branchTexture!: GPUTexture;
    private sampler!: GPUSampler;

    // Meshes (Buffers)
    private quadMesh!: MeshBuffers; // For Sky
    private terrainMesh!: MeshBuffers;
    private trunkMesh!: MeshBuffers;
    private foliageMesh!: MeshBuffers;
    private waterMesh!: MeshBuffers;

    // Tree Instances
    private treePositions: vec3[] = [];

    // URLs
    private urls = {
        sky: 'https://img.noahcohn.com/media/sky.png',
        ground: 'https://img.noahcohn.com/media/ground.png',
        bark: 'https://img.noahcohn.com/media/bark.png',
        branch: 'https://img.noahcohn.com/media/branch.png'
    };

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.camera = new Camera(vec3.fromValues(0, 2, 0), canvas.width / canvas.height);
        this.inputHandler = new InputHandler(canvas);

        // Generate random tree positions
        for(let i=0; i<100; i++) {
            const x = (Math.random() - 0.5) * 100;
            const z = (Math.random() - 0.5) * 100;
            // Keep center clear
            if(Math.sqrt(x*x + z*z) > 10) {
                this.treePositions.push(vec3.fromValues(x, 0, z));
            }
        }
    }

    public async init(): Promise<boolean> {
        try {
            if (!navigator.gpu) return false;
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) return false;
            this.device = await adapter.requestDevice();
            this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
            this.format = navigator.gpu.getPreferredCanvasFormat();

            this.context.configure({
                device: this.device,
                format: this.format,
                alphaMode: 'premultiplied'
            });

            // 1. Create Sampler
            this.sampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
                mipmapFilter: 'linear',
                addressModeU: 'repeat',
                addressModeV: 'repeat'
            });

            // 2. Load Textures
            await Promise.all([
                this.loadTexture(this.urls.sky, [135, 206, 235, 255]).then(t => this.skyTexture = t),
                this.loadTexture(this.urls.ground, [34, 139, 34, 255]).then(t => this.groundTexture = t),
                this.loadTexture(this.urls.bark, [139, 69, 19, 255]).then(t => this.barkTexture = t),
                this.loadTexture(this.urls.branch, [0, 100, 0, 255]).then(t => this.branchTexture = t)
            ]);

            // 3. Create Geometry Buffers
            this.quadMesh = this.createMeshBuffers(Geometry.createPlane(2, 2, 1));
            this.terrainMesh = this.createMeshBuffers(Geometry.createPlane(200, 200, 100));
            this.waterMesh = this.createMeshBuffers(Geometry.createPlane(200, 200, 20));
            this.trunkMesh = this.createMeshBuffers(Geometry.createTrunk(4, 0.4));
            this.foliageMesh = this.createMeshBuffers(Geometry.createFoliage(4));

            // Create Instance Buffer
            const instanceData = new Float32Array(this.treePositions.length * 3);
            this.treePositions.forEach((pos, i) => {
                instanceData.set(pos, i * 3);
            });
            this.instanceBuffer = this.device.createBuffer({
                size: instanceData.byteLength,
                usage: GPUBufferUsage.VERTEX,
                mappedAtCreation: true
            });
            new Float32Array(this.instanceBuffer.getMappedRange()).set(instanceData);
            this.instanceBuffer.unmap();

            // 4. Create Uniform Buffers
            this.globalUniformBuffer = this.device.createBuffer({
                size: 160,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });

            // 5. Create Pipelines
            await this.createPipelines();

            this.ready = true;
            return true;
        } catch (e) {
            console.error("Renderer Init Failed", e);
            return false;
        }
    }

    private async loadTexture(url: string, fallbackColor: number[] = [255, 0, 255, 255]): Promise<GPUTexture> {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Status: ${res.status}`);
            const blob = await res.blob();
            const bitmap = await createImageBitmap(blob);

            const texture = this.device.createTexture({
                size: [bitmap.width, bitmap.height],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
            });

            this.device.queue.copyExternalImageToTexture(
                { source: bitmap },
                { texture: texture },
                [bitmap.width, bitmap.height]
            );
            return texture;
        } catch (e) {
            console.warn(`Failed to load texture ${url}, using fallback.`, e);
            const texture = this.device.createTexture({
                size: [1, 1],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
            });
            const data = new Uint8Array(fallbackColor);
            this.device.queue.writeTexture(
                { texture },
                data,
                { bytesPerRow: 4 },
                [1, 1]
            );
            return texture;
        }
    }

    private createMeshBuffers(mesh: Mesh): MeshBuffers {
        const vertexBuffer = this.device.createBuffer({
            size: mesh.vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX,
            mappedAtCreation: true
        });
        new Float32Array(vertexBuffer.getMappedRange()).set(mesh.vertexData);
        vertexBuffer.unmap();

        const indexBuffer = this.device.createBuffer({
            size: mesh.indexData!.byteLength,
            usage: GPUBufferUsage.INDEX,
            mappedAtCreation: true
        });
        if (mesh.indexData instanceof Uint16Array) {
             new Uint16Array(indexBuffer.getMappedRange()).set(mesh.indexData);
        } else {
             new Uint32Array(indexBuffer.getMappedRange()).set(mesh.indexData as Uint32Array);
        }
        indexBuffer.unmap();

        return {
            vertexBuffer,
            indexBuffer,
            indexCount: mesh.indexCount!,
            indexFormat: mesh.indexData instanceof Uint16Array ? 'uint16' : 'uint32'
        };
    }

    private async createPipelines() {
        const loadShader = async (path: string) => {
            const res = await fetch(path);
            return res.text();
        };

        const [skyCode, terrainCode, treeCode, waterCode] = await Promise.all([
            loadShader('./shaders/sky.wgsl'),
            loadShader('./shaders/terrain.wgsl'),
            loadShader('./shaders/tree.wgsl'),
            loadShader('./shaders/water.wgsl')
        ]);

        const layout = 'auto';

        const createPipeline = async (code: string, label: string, isInstanced: boolean, cullMode: GPUCullMode = 'back', blendComp: GPUBlendComponent | undefined = undefined) => {
             const module = this.device.createShaderModule({ label, code });

             const buffers: GPUVertexBufferLayout[] = [{
                 arrayStride: 32,
                 attributes: [
                     { shaderLocation: 0, offset: 0, format: 'float32x3' as GPUVertexFormat }, // Pos
                     { shaderLocation: 1, offset: 12, format: 'float32x3' as GPUVertexFormat }, // Normal
                     { shaderLocation: 2, offset: 24, format: 'float32x2' as GPUVertexFormat }, // UV
                 ]
             }];

             if (isInstanced) {
                 buffers.push({
                     arrayStride: 12, // vec3
                     stepMode: 'instance',
                     attributes: [
                         { shaderLocation: 3, offset: 0, format: 'float32x3' as GPUVertexFormat } // Instance Pos
                     ]
                 });
             }

             return await this.device.createRenderPipelineAsync({
                 label,
                 layout,
                 vertex: {
                     module,
                     entryPoint: 'vs_main',
                     buffers
                 },
                 fragment: {
                     module,
                     entryPoint: 'fs_main',
                     targets: [{
                         format: this.format,
                         blend: blendComp ? { color: blendComp, alpha: blendComp } : undefined
                     }]
                 },
                 primitive: { topology: 'triangle-list', cullMode },
                 depthStencil: {
                     depthWriteEnabled: true,
                     depthCompare: 'less',
                     format: 'depth24plus'
                 }
             });
        };

        this.skyPipeline = await createPipeline(skyCode, 'sky', false, 'none');
        this.terrainPipeline = await createPipeline(terrainCode, 'terrain', false);

        // Tree Pipelines are INSTANCED
        this.treeTrunkPipeline = await createPipeline(treeCode, 'trunk', true);
        this.treeLeavesPipeline = await createPipeline(treeCode, 'leaves', true, 'none');

        this.waterPipeline = await createPipeline(waterCode, 'water', false, 'back', {
            operation: 'add',
            srcFactor: 'src-alpha',
            dstFactor: 'one-minus-src-alpha'
        } as GPUBlendComponent);
    }

    public render() {
        if (!this.ready || !this.device) return;

        const dt = 0.016;
        const mouseDelta = this.inputHandler.getMouseDelta();
        if (this.inputHandler.keys['KeyW']) this.camera.processKeyboard('FORWARD', dt);
        if (this.inputHandler.keys['KeyS']) this.camera.processKeyboard('BACKWARD', dt);
        if (this.inputHandler.keys['KeyA']) this.camera.processKeyboard('LEFT', dt);
        if (this.inputHandler.keys['KeyD']) this.camera.processKeyboard('RIGHT', dt);
        
        if (Math.abs(mouseDelta.x) > 0 || Math.abs(mouseDelta.y) > 0) {
            this.camera.processMouseMovement(mouseDelta.x, mouseDelta.y);
        }

        const view = this.camera.getViewMatrix();
        const projection = this.camera.getProjectionMatrix();
        const time = performance.now() / 1000.0;
        
        const uniformData = new Float32Array(40);
        uniformData.set(view as Float32Array, 0);
        uniformData.set(projection as Float32Array, 16);
        uniformData.set(this.camera.position as Float32Array, 32);
        uniformData[36] = time;

        this.device.queue.writeBuffer(this.globalUniformBuffer, 0, uniformData);

        const canvas = this.canvas;
        if (!this.depthTexture || this.depthTexture.width !== canvas.width || this.depthTexture.height !== canvas.height) {
            if (this.depthTexture) this.depthTexture.destroy();
            this.depthTexture = this.device.createTexture({
                size: [canvas.width, canvas.height],
                format: 'depth24plus',
                usage: GPUTextureUsage.RENDER_ATTACHMENT
            });
            this.camera.updateAspect(canvas.width / canvas.height);
        }

        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();

        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: textureView,
                clearValue: { r: 0.1, g: 0.2, b: 0.3, a: 1.0 },
                loadOp: 'clear' as GPULoadOp,
                storeOp: 'store' as GPUStoreOp
            }],
            depthStencilAttachment: {
                view: this.depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear' as GPULoadOp,
                depthStoreOp: 'store' as GPUStoreOp
            }
        });

        const bindGroupCache = new Map<string, GPUBindGroup>();

        const getBindGroup = (pipeline: GPURenderPipeline, texture: GPUTexture, name: string) => {
            if(!bindGroupCache.has(name)) {
                const bg = this.device.createBindGroup({
                    layout: pipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: this.globalUniformBuffer } },
                        { binding: 1, resource: this.sampler },
                        { binding: 2, resource: texture.createView() }
                    ]
                });
                bindGroupCache.set(name, bg);
            }
            return bindGroupCache.get(name)!;
        };

        // 1. Sky
        passEncoder.setPipeline(this.skyPipeline);
        passEncoder.setBindGroup(0, getBindGroup(this.skyPipeline, this.skyTexture, 'sky'));
        passEncoder.setVertexBuffer(0, this.quadMesh.vertexBuffer);
        passEncoder.setIndexBuffer(this.quadMesh.indexBuffer, this.quadMesh.indexFormat);
        passEncoder.drawIndexed(this.quadMesh.indexCount);

        // 2. Terrain
        passEncoder.setPipeline(this.terrainPipeline);
        passEncoder.setBindGroup(0, getBindGroup(this.terrainPipeline, this.groundTexture, 'ground'));
        passEncoder.setVertexBuffer(0, this.terrainMesh.vertexBuffer);
        passEncoder.setIndexBuffer(this.terrainMesh.indexBuffer, this.terrainMesh.indexFormat);
        passEncoder.drawIndexed(this.terrainMesh.indexCount);

        // 3. Trees
        const instanceCount = this.treePositions.length;
        passEncoder.setVertexBuffer(1, this.instanceBuffer); // Bind Instance Buffer to slot 1

        // Trunk
        passEncoder.setPipeline(this.treeTrunkPipeline);
        passEncoder.setBindGroup(0, getBindGroup(this.treeTrunkPipeline, this.barkTexture, 'trunk'));
        passEncoder.setVertexBuffer(0, this.trunkMesh.vertexBuffer);
        passEncoder.setIndexBuffer(this.trunkMesh.indexBuffer, this.trunkMesh.indexFormat);
        passEncoder.drawIndexed(this.trunkMesh.indexCount, instanceCount);

        // Leaves
        passEncoder.setPipeline(this.treeLeavesPipeline);
        passEncoder.setBindGroup(0, getBindGroup(this.treeLeavesPipeline, this.branchTexture, 'leaves'));
        passEncoder.setVertexBuffer(0, this.foliageMesh.vertexBuffer);
        passEncoder.setIndexBuffer(this.foliageMesh.indexBuffer, this.foliageMesh.indexFormat);
        passEncoder.drawIndexed(this.foliageMesh.indexCount, instanceCount);

        // 4. Water
        passEncoder.setPipeline(this.waterPipeline);
        passEncoder.setBindGroup(0, getBindGroup(this.waterPipeline, this.skyTexture, 'water'));
        passEncoder.setVertexBuffer(0, this.waterMesh.vertexBuffer);
        passEncoder.setIndexBuffer(this.waterMesh.indexBuffer, this.waterMesh.indexFormat);
        passEncoder.drawIndexed(this.waterMesh.indexCount);

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}

interface MeshBuffers {
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    indexCount: number;
    indexFormat: GPUIndexFormat;
}
