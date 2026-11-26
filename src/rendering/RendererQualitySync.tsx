/**
 * RendererQualitySync — applies the quality contract to the LIVE renderer.
 *
 * Must live inside <Canvas>.
 *
 * Before this component, changing the graphics quality preset mid-run remounted
 * the whole Canvas: Rapier, the 7-segment treadmill, WASM SWE grids, audio, and
 * the vehicle body were all torn down to flip DPR or shadow filtering. The
 * Canvas `key` now only carries what genuinely needs a new WebGL context (see
 * `rendererContextCreationKey`), and the rest of the contract is re-applied here
 * on the existing renderer.
 *
 * The adaptive render scale is applied by the post pipeline as a viewport
 * multiplier; it never changes the Canvas DPR or target allocation.
 *
 * R3F already re-runs its own `configure` for the `dpr` and `shadows` Canvas
 * props, so those land without help. What it does not do is invalidate compiled
 * programs when `shadowMap.type` changes — three bakes `SHADOWMAP_TYPE_*` into
 * each program and does not list it in `needsProgramChange`. That recompile is
 * what `applyRendererQualityUpdate` adds, and it is why this component exists
 * rather than relying on the Canvas props alone.
 */
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useQualityPreset, useRenderScale } from '../systems/GameState';
import { applyRendererQualityUpdate } from './applyRendererContextOptions';
import { deriveRendererContextOptions } from './deriveRendererContextOptions';
import { getSessionGraphicsEnvelope } from './probeGraphicsCapability';
import { traceCounter, traceName } from '../debug/trace/traceProbe';

const DPR_CEILING_COUNTER = traceName('renderer DPR ceiling');
const RENDER_SCALE_COUNTER = traceName('renderer render scale');

export default function RendererQualitySync() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const quality = useQualityPreset();
  // The valve moves with frame time; RendererQualitySync keeps its diagnostics
  // aligned with the value consumed by the render pipeline.
  const renderScale = useRenderScale();

  useEffect(() => {
    if (!gl) return;

    const options = deriveRendererContextOptions(quality, {
      devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
      // The envelope is frozen at boot; only the live half of the contract
      // below actually varies with `quality`.
      envelope: getSessionGraphicsEnvelope(),
    });

    // `failIfMajorPerformanceCaveat`, `antialias`, `alpha`, `depth`, `stencil`
    // are creation-time attributes and are deliberately NOT touched here — a
    // preset change that moves any of them changes the Canvas key instead.
    applyRendererQualityUpdate(gl, options, scene);
    traceCounter(DPR_CEILING_COUNTER, options.dprCeiling);
  }, [gl, quality, scene]);

  useEffect(() => {
    traceCounter(RENDER_SCALE_COUNTER, renderScale);
  }, [renderScale]);

  return null;
}
