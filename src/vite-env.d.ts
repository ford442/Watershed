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
    /** Generate the next treadmill segment now (verification/spawn_profile.mjs). */
    advanceTreadmill: () => boolean;
    /** `?input=script:` only: advance n sim frames, render the last (verification/input_script_smoke.mjs). */
    stepScripted: (n: number) => number;
    /** True once the scripted source is loaded and the run is live. */
    isScriptedReady: () => boolean;
    /** Checkpoint splits recorded so far this run (SplitRecorder). */
    getSplits: () => Array<{ segmentIndex: number; tMs: number; speed: number }>;
    /** Runner pose / speed / segment plus the script and hub clocks. */
    getScriptedTelemetry: () => {
      pos: { x: number; y: number; z: number } | null;
      speed: number;
      segmentIndex: number;
      isWipeout: boolean;
      /** Vertical OOB envelope of the segment frame under the runner. */
      envelope: { segmentIndex: number | null; yMin: number; yMax: number } | null;
      simTimeSec: number;
      ghostElapsedMs: number;
      hubTickMeanMs: number;
      hubTicks: number;
      /** The hub's merged frame as of the last tick (#486 C smoke: which device, how hard). */
      input: { source: string; moveX: number; moveY: number; lookDX: number; lookDY: number; buttons: number; frameIdx: number };
    };
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
  /** Raft worker water-force diagnostics (dev builds). */
  __watershedPhysicsWorker?: { simLinked: boolean; waterForce: unknown; tickOrder: string[] };
  /** The runner's last physics step (PhysicsDebugOverlay, verification harnesses). */
  __watershedPhysicsDebug?: import('./vehicles/RunnerVehicle/constants').PhysicsDebugSnapshot;
}
