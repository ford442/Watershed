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
 * R3F already re-runs its own `configure` for the `dpr` and `shadows` Canvas
 * props, so those land without help. What it does not do is invalidate compiled
 * programs when `shadowMap.type` changes — three bakes `SHADOWMAP_TYPE_*` into
 * each program and does not list it in `needsProgramChange`. That recompile is
 * what `applyRendererQualityUpdate` adds, and it is why this component exists
 * rather than relying on the Canvas props alone.
 */
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useQualityPreset } from '../systems/GameState';
import { applyRendererQualityUpdate } from './applyRendererContextOptions';
import { deriveRendererContextOptions } from './deriveRendererContextOptions';
import { isSoftwareRendererAllowed } from './rendererConfig';

export default function RendererQualitySync() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const setDpr = useThree((state) => state.setDpr);
  const quality = useQualityPreset();

  useEffect(() => {
    if (!gl) return;

    const options = deriveRendererContextOptions(quality, {
      devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
      allowSoftwareFallback: isSoftwareRendererAllowed(),
    });

    // `failIfMajorPerformanceCaveat`, `antialias`, `alpha`, `depth`, `stencil`
    // are creation-time attributes and are deliberately NOT touched here — a
    // preset change that moves any of them changes the Canvas key instead.
    applyRendererQualityUpdate(gl, options, scene);

    // R3F derives DPR from the Canvas `dpr` prop, which App already updates.
    // Setting it here too keeps any Canvas that forgets the prop (the editor,
    // future offscreen surfaces) on the same contract.
    setDpr?.([1, options.dprMax]);
  }, [gl, quality, scene, setDpr]);

  return null;
}
