/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

interface Window {
  // Diagnostics: one `window.__watershed` object, declared and installed by src/harness/debugApi.ts.
  __watershedScreenshot?: {
    teleportToZ: (z: number, y?: number) => boolean;
    teleportToSegment: (segmentIndex: number) => boolean;
    getSpawnPoints: () => Record<number, { x: number; y: number; z: number }>;
    /** Generate the next treadmill segment now (verification/spawn_profile.mjs). */
    advanceTreadmill: () => boolean;
    /** Write the settings quality preset, as the adaptive ladder does (verification/quality_drop_trace.mjs). */
    setQuality: (quality: 'low' | 'medium' | 'high' | 'ultra') => void;
    /** `?input=script:` only: advance n sim frames, render the last (verification/input_script_smoke.mjs). */
    stepScripted: (n: number) => number;
    /** True once the scripted source is loaded and the run is live. */
    isScriptedReady: () => boolean;
    /** isScriptedReady's parts, for a harness to say which one never arrived. */
    getScriptedReadiness: () => {
      scripted: boolean;
      live: boolean;
      swe: 'pending' | 'ready' | 'off';
      sweActive: boolean;
      /** The run map's hazards can step (none authored, or the lazy runtime has loaded). */
      hazards: boolean;
    };
    /** Checkpoint splits recorded so far this run (SplitRecorder). */
    getSplits: () => Array<{ segmentIndex: number; tMs: number; speed: number }>;
    /** SWE state checksum at each split, aligned with getSplits() (null where SWE was off). */
    getSplitChecksums: () => Array<string | null>;
    /** The run's hazard log so far (hazardLog.ts): each phase change and hit on the ghost clock. */
    getHazardLog: () => Array<{ hazardId: string; event: string; tMs: number }>;
    /** This run so far as a `.wsghost` JSON string (`?replay=`-able), or null before the first sample. */
    getGhostFile: () => string | null;
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
}
