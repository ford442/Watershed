/**
 * useRendererBoot.ts — boot-time graphics negotiation and the renderer's live
 * state, split out of App (#521 C1).
 *
 * Owns the GraphicsBoot (probe + boot-crash verdict, decided once per page
 * load), the renderer / material-backend requests, the derived context options
 * and Canvas identity key, the GPU-loss recovery epoch, and the three boot-time
 * quality clamps. `RendererBoot.tsx` renders the Canvas from what this returns.
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useProgress } from '@react-three/drei';
import {
  beginBootAttempt,
  buildCanvasIdentityKey,
  deriveRendererContextOptions,
  isSoftwareRendererAllowed,
  negotiateBootGraphics,
  parseRendererPreference,
  recordBootFailure,
  type BootFailureRecord,
  type GraphicsCapability,
  type RendererContextOptions,
  type RendererPreference,
} from '../rendering';
import { requestedMaterialBackend, type MaterialBackend } from '../rendering/materialBackend';
import { attachGpuLossHandlers, isGpuLossDebugEnabled, simulateGpuLoss } from '../rendering/gpuLossRecovery';
import { useSettingsStore } from '../systems/settings/useSettingsStore';
import { useGameStore, useQualityPreset, useRenderScale } from '../systems/GameState';
import { parseQualityOverride } from '../utils/qualityOverride';

/**
 * The result of boot-time graphics negotiation, plus the boot-crash verdict.
 *
 * Both are session facts, decided once, *before* anything mounts — see
 * `probeGraphicsCapability.ts` and `bootCrashGuard.ts`.
 */
export interface GraphicsBoot {
  capability: GraphicsCapability;
  /** What the previous start left behind, or null when it drew a frame. */
  previousFailure: BootFailureRecord | null;
}

let negotiatedBoot: GraphicsBoot | null = null;

/**
 * Negotiate once per page load.
 *
 * Memoised at module scope rather than in a `useState` initializer because
 * `beginBootAttempt()` has a side effect that must happen exactly once: a second
 * call would read back the record this one just armed and misreport a healthy
 * boot as a crashed one.
 */
function resolveGraphicsBoot(): GraphicsBoot {
  if (negotiatedBoot) return negotiatedBoot;
  const previousFailure = beginBootAttempt();
  negotiatedBoot = {
    previousFailure,
    capability: negotiateBootGraphics({
      // The capture harness pins its envelope instead of probing — see
      // CAPTURE_ENVELOPE.
      captureMode: isSoftwareRendererAllowed(),
      previousBootFailed: previousFailure !== null,
    }),
  };
  return negotiatedBoot;
}

export interface RendererBootState extends GraphicsBoot {
  rendererPreference: RendererPreference;
  /** Session state only (remounts the Canvas); the DebugPanel's switch also persists it. */
  setRendererPreference: Dispatch<SetStateAction<RendererPreference>>;
  materialBackend: MaterialBackend;
  /** Session state only (remounts the Canvas); the DebugPanel's switch also persists it. */
  setMaterialBackend: Dispatch<SetStateAction<MaterialBackend>>;
  contextOptions: RendererContextOptions;
  canvasKey: string;
  canvasReady: boolean;
  /** Canvas up and no assets loading — what Start / Enter / harness autostarts wait on. */
  bootReady: boolean;
  /** The live context is lost and recovery is pending. */
  webglRecovering: boolean;
  /** A fresh renderer came up: mark the Canvas ready and move GPU-loss handling to it. */
  attachRenderer: (gl: unknown) => void;
}

export function useRendererBoot(graphicsBoot?: GraphicsBoot): RendererBootState {
  // Before <Canvas>, before <Physics>, before anything mounts.
  const [{ capability: graphicsCapability, previousFailure }] = useState<GraphicsBoot>(
    () => graphicsBoot ?? resolveGraphicsBoot()
  );
  const [rendererPreference, setRendererPreference] = useState<RendererPreference>(() =>
    parseRendererPreference()
  );
  // #256 path A: which material implementation the scene builds. Changing it
  // remounts the Canvas, because the renderer class itself depends on it.
  // The renderer *request* — not a material host (see requestedMaterialBackend).
  const [materialBackend, setMaterialBackend] = useState<MaterialBackend>(
    () => requestedMaterialBackend().backend
  );
  const qualityPreset = useQualityPreset();
  const renderScale = useRenderScale();
  const { active: assetsLoading } = useProgress();
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const [canvasReady, setCanvasReady] = useState(false);
  const bootReady = canvasReady && !assetsLoading;
  const [webglRecovering, setWebglRecovering] = useState(false);
  // The live canvas's GPU-loss listeners/hooks (gpuLossRecovery.ts); detached
  // when the next renderer comes up and when App unmounts.
  const detachGpuLoss = useRef<(() => void) | null>(null);
  useEffect(() => () => detachGpuLoss.current?.(), []);
  const contextOptions = deriveRendererContextOptions(qualityPreset, {
    devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
    // Frozen at boot. Antialias, power preference, and the caveat flag are
    // creation-time attributes; taking them from the negotiated envelope instead
    // of the preset is what makes every preset share one Canvas key.
    envelope: graphicsCapability.envelope,
    // #419 phase C: LODManager's frame-time valve, multiplying the preset's DPR
    // ceiling. It moves the `dpr` prop and nothing else — the Canvas key is
    // derived from creation attributes only, so closing the valve mid-run
    // cannot remount the Canvas any more than a preset change can.
    renderScale,
  });
  // Only creation-time context attributes belong in the Canvas key, and none of
  // them varies with quality any more. DPR, shadow mode, and shadow map size are
  // re-applied live by RendererQualitySync + SceneLighting, so *any* preset
  // change mid-run — low ↔ ultra included — keeps Rapier, the track treadmill,
  // WASM SWE grids, audio, and the vehicle body alive.
  const canvasKey = buildCanvasIdentityKey({
    rendererPreference,
    materialBackend,
    contextOptions,
    epoch: canvasEpoch,
  });
  // The previous start never drew a frame, lost its context, or threw out of the
  // renderer factory (see bootCrashGuard). Clamp to `low` once settings have
  // hydrated — earlier and rehydration would put the persisted preset straight
  // back. Written to the *settings* store because SettingsSync owns the
  // settings → GameState direction and would otherwise re-push the old value;
  // the badge says what happened and how to raise it again.
  const settingsHydrated = useSettingsStore((state) => state._hasHydrated);
  const crashClampApplied = useRef(false);
  useEffect(() => {
    if (!previousFailure || !settingsHydrated || crashClampApplied.current) return;
    crashClampApplied.current = true;
    useSettingsStore.getState().setQuality('low');
    useGameStore.getState().setSettings({ quality: 'low' });
  }, [previousFailure, settingsHydrated]);

  // A software / flagged-driver context ('caveat') is the machine that cannot
  // afford `high`: the adaptive valve needs minutes there, so start at `low`
  // instead. Session-only — it touches GameState but not the persisted settings,
  // so a good GPU on a later load keeps the player's own preset. The settings
  // panel still applies a deliberate change (SettingsSync fires on change only).
  const caveatClampApplied = useRef(false);
  const isCaveatBoot =
    graphicsCapability.tier === 'degraded' && graphicsCapability.reason === 'caveat';
  useEffect(() => {
    if (!isCaveatBoot || !settingsHydrated || caveatClampApplied.current) return;
    caveatClampApplied.current = true;
    useGameStore.getState().setSettings({ quality: 'low' });
  }, [isCaveatBoot, settingsHydrated]);

  // `?quality=` (harnesses) wins over both clamps for this session: the replay
  // smoke runs SWE on a software boot that would otherwise start at Low.
  const qualityOverrideApplied = useRef(false);
  useEffect(() => {
    const preset = parseQualityOverride();
    if (!preset || !settingsHydrated || qualityOverrideApplied.current) return;
    qualityOverrideApplied.current = true;
    useGameStore.getState().setSettings({ quality: preset });
  }, [settingsHydrated]);

  useEffect(() => {
    setCanvasReady(false);
  }, [canvasEpoch]);

  const attachRenderer = useCallback((gl: unknown) => {
    setCanvasReady(true);
    // Intentional Canvas remounts (quality key change, renderer swap) dispose
    // the old context and fire `webglcontextlost` without a matching restore on
    // the new element. Clear the toast whenever a fresh renderer comes up
    // successfully.
    setWebglRecovering(false);
    // Previous canvas's handlers go first: a remount must not hear the old
    // context's teardown as a fresh loss.
    detachGpuLoss.current?.();
    detachGpuLoss.current = attachGpuLossHandlers(gl, {
      onLost(kind, detail) {
        setWebglRecovering(true);
        // If the tab is reloaded before the GPU comes back, the next boot
        // should know this was a GPU loss, not a slow start.
        recordBootFailure(kind);
        console.warn(
          kind === 'device-lost'
            ? `[App] WebGPU device lost${detail ? ` (${detail})` : ''} — remounting Canvas`
            : '[App] WebGL context lost — waiting for restore',
        );
      },
      onRestored(kind) {
        if (kind === 'context-lost') console.info('[App] WebGL context restored — remounting Canvas');
        setWebglRecovering(false);
        setCanvasEpoch((epoch) => epoch + 1);
      },
    });
    if (isGpuLossDebugEnabled()) {
      (window as Window & { __watershedLoseGpu?: () => string | null }).__watershedLoseGpu = () =>
        simulateGpuLoss(gl);
    }
  }, []);

  return {
    capability: graphicsCapability,
    previousFailure,
    rendererPreference,
    setRendererPreference,
    materialBackend,
    setMaterialBackend,
    contextOptions,
    canvasKey,
    canvasReady,
    bootReady,
    webglRecovering,
    attachRenderer,
  };
}
