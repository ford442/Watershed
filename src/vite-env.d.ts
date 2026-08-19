/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

interface Window {
  __watershedCameraDiag?: {
    uuid: string;
    pos: { x: number; y: number; z: number };
    quat: { x: number; y: number; z: number; w: number };
    matrixWorld: number[];
  };
  __watershedScreenshot?: {
    teleportToZ: (z: number, y?: number) => boolean;
    teleportToSegment: (segmentIndex: number) => boolean;
    getSpawnPoints: () => Record<number, { x: number; y: number; z: number }>;
  };
  gpuComputeAvailable?: boolean;
  gpuComputeReason?: string | null;
  gpuComputeDiagnostics?: {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
    features: string[];
    limits: {
      maxTextureDimension2D: number;
      maxComputeWorkgroupSizeX: number;
      maxComputeWorkgroupSizeY: number;
      maxComputeInvocationsPerWorkgroup: number;
      maxStorageBufferBindingSize: number;
    };
  } | null;
  gpuChoreBackend?: string | null;
  gpuChoreReason?: string | null;
}
