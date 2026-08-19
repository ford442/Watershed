import * as THREE from 'three';
import { QUALITY_SETTINGS } from '../systems/LODManager';
import {
  DEFAULT_TONE_MAPPING_EXPOSURE,
  DESYNCHRONIZED_ENABLED,
  EDITOR_QUALITY_PRESET,
  LOGARITHMIC_DEPTH_BUFFER_ENABLED,
  deriveEditorContextOptions,
  deriveRendererContextOptions,
  buildCanvasIdentityKey,
  rendererContextCreationKey,
  resolveCanvasDpr,
  shadowModeToCanvasProp,
  toContextAttributes,
} from './deriveRendererContextOptions';
import type { QualityPreset } from '../systems/GameState';

const ALL_PRESETS: QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

describe('deriveRendererContextOptions', () => {
  it('maps low preset to minimal GPU cost', () => {
    const opts = deriveRendererContextOptions('low');
    expect(opts).toMatchObject({
      dprMax: 1.0,
      antialias: false,
      shadowMode: 'off',
      shadowMapSize: null,
      powerPreference: 'high-performance',
      outputColorSpace: THREE.SRGBColorSpace,
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: DEFAULT_TONE_MAPPING_EXPOSURE,
    });
  });

  it('maps medium preset to basic shadows and capped DPR', () => {
    const opts = deriveRendererContextOptions('medium');
    expect(opts).toMatchObject({
      dprMax: 1.25,
      antialias: true,
      shadowMode: 'basic',
      shadowMapSize: 1024,
    });
  });

  it('maps high preset to pre-contract defaults (antialias, soft shadows, DPR 2)', () => {
    const opts = deriveRendererContextOptions('high');
    expect(opts).toMatchObject({
      dprMax: 2,
      antialias: true,
      shadowMode: 'soft',
      shadowMapSize: 2048,
      powerPreference: 'high-performance',
      outputColorSpace: THREE.SRGBColorSpace,
      toneMapping: THREE.ACESFilmicToneMapping,
    });
  });

  it('maps ultra preset to native DPR and larger shadow maps on retina', () => {
    const opts = deriveRendererContextOptions('ultra', { devicePixelRatio: 2 });
    expect(opts).toMatchObject({
      dprMax: 2,
      antialias: true,
      shadowMode: 'soft',
      shadowMapSize: 4096,
    });
  });

  it('maps ultra preset to 2048 shadow map on 1x displays', () => {
    const opts = deriveRendererContextOptions('ultra', { devicePixelRatio: 1 });
    expect(opts.shadowMapSize).toBe(2048);
    expect(opts.dprMax).toBe(1);
  });

  it('keeps logarithmic depth disabled (evaluated, deferred)', () => {
    expect(LOGARITHMIC_DEPTH_BUFFER_ENABLED).toBe(false);
  });
});

describe('LOD ↔ renderer shadow map contract', () => {
  it('aligns static LOD shadowMapSize baselines with deriveRendererContextOptions', () => {
    expect(QUALITY_SETTINGS.medium.shadowMapSize).toBe(
      deriveRendererContextOptions('medium').shadowMapSize
    );
    expect(QUALITY_SETTINGS.high.shadowMapSize).toBe(
      deriveRendererContextOptions('high').shadowMapSize
    );
    // Ultra LOD table stores the retina max; live lights use derive (DPR-aware).
    expect(QUALITY_SETTINGS.ultra.shadowMapSize).toBe(
      deriveRendererContextOptions('ultra', { devicePixelRatio: 2 }).shadowMapSize
    );
    expect(deriveRendererContextOptions('low').shadowMapSize).toBeNull();
    expect(QUALITY_SETTINGS.low.shadowMapSize).toBe(1024);
  });
});

describe('shadowModeToCanvasProp', () => {
  it('returns false for off', () => {
    expect(shadowModeToCanvasProp('off')).toBe(false);
  });

  it('returns basic and soft for respective modes', () => {
    expect(shadowModeToCanvasProp('basic')).toBe('basic');
    expect(shadowModeToCanvasProp('soft')).toBe('soft');
  });
});

describe('resolveCanvasDpr', () => {
  it('clamps device pixel ratio to [1, dprMax]', () => {
    expect(resolveCanvasDpr(2, 3)).toBe(2);
    expect(resolveCanvasDpr(2, 1.5)).toBe(1.5);
    expect(resolveCanvasDpr(1.25, 2)).toBe(1.25);
    expect(resolveCanvasDpr(2, 0.5)).toBe(1);
  });
});

describe('pinned context attributes', () => {
  it.each(ALL_PRESETS)('pins the opaque/depth/stencil attributes on %s', (preset) => {
    expect(deriveRendererContextOptions(preset)).toMatchObject({
      alpha: false,
      premultipliedAlpha: true,
      depth: true,
      stencil: true,
    });
  });

  it('keeps desynchronized off — THREE r168 does not forward it anyway', () => {
    expect(DESYNCHRONIZED_ENABLED).toBe(false);
  });

  it('rejects software GL above the low preset', () => {
    expect(deriveRendererContextOptions('medium').failIfMajorPerformanceCaveat).toBe(true);
    expect(deriveRendererContextOptions('high').failIfMajorPerformanceCaveat).toBe(true);
    expect(deriveRendererContextOptions('ultra').failIfMajorPerformanceCaveat).toBe(true);
  });

  it('accepts software GL on low — low is the weak-machine fallback', () => {
    expect(deriveRendererContextOptions('low').failIfMajorPerformanceCaveat).toBe(false);
  });

  it.each(ALL_PRESETS)(
    'lets the capture/CI harness opt out of the caveat check on %s',
    (preset) => {
      const opts = deriveRendererContextOptions(preset, { allowSoftwareFallback: true });
      expect(opts.failIfMajorPerformanceCaveat).toBe(false);
    }
  );

  it('forwards every creation attribute to the renderer constructor', () => {
    const attributes = toContextAttributes(deriveRendererContextOptions('high'));
    expect(attributes).toEqual({
      antialias: true,
      alpha: false,
      premultipliedAlpha: true,
      depth: true,
      stencil: true,
      failIfMajorPerformanceCaveat: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: false,
    });
  });

  it('never puts a live-applicable property in the creation attributes', () => {
    const attributes = toContextAttributes(deriveRendererContextOptions('high'));
    expect(attributes).not.toHaveProperty('dprMax');
    expect(attributes).not.toHaveProperty('shadowMode');
    expect(attributes).not.toHaveProperty('shadowMapSize');
    expect(attributes).not.toHaveProperty('toneMapping');
  });
});

describe('rendererContextCreationKey — what forces a Canvas remount', () => {
  const keyFor = (preset: QualityPreset) =>
    rendererContextCreationKey(deriveRendererContextOptions(preset, { devicePixelRatio: 2 }));

  it('is identical across medium / high / ultra so mid-run swaps apply live', () => {
    expect(keyFor('medium')).toBe(keyFor('high'));
    expect(keyFor('high')).toBe(keyFor('ultra'));
  });

  it('differs for low, which turns antialias off and accepts software GL', () => {
    expect(keyFor('low')).not.toBe(keyFor('high'));
  });

  it('ignores DPR and shadow configuration, which are applied live', () => {
    const at1x = rendererContextCreationKey(
      deriveRendererContextOptions('ultra', { devicePixelRatio: 1 })
    );
    const at2x = rendererContextCreationKey(
      deriveRendererContextOptions('ultra', { devicePixelRatio: 2 })
    );
    expect(at1x).toBe(at2x);
    expect(keyFor('medium')).toBe(keyFor('high')); // basic vs soft shadows
  });

  it('changes when the caveat opt-out changes — it is a context attribute', () => {
    const strict = rendererContextCreationKey(deriveRendererContextOptions('high'));
    const permissive = rendererContextCreationKey(
      deriveRendererContextOptions('high', { allowSoftwareFallback: true })
    );
    expect(strict).not.toBe(permissive);
  });
});

describe('deriveEditorContextOptions', () => {
  it('uses the same contract as the game at the high preset', () => {
    const editor = deriveEditorContextOptions({ devicePixelRatio: 1 });
    const game = deriveRendererContextOptions(EDITOR_QUALITY_PRESET, {
      devicePixelRatio: 1,
      allowSoftwareFallback: true,
    });
    expect(editor).toEqual(game);
  });

  it('allows software GL so the authoring tool always boots', () => {
    expect(deriveEditorContextOptions().failIfMajorPerformanceCaveat).toBe(false);
  });
});

describe('buildCanvasIdentityKey — the actual Canvas remount trigger', () => {
  const keyFor = (
    quality: QualityPreset,
    overrides: Partial<{
      rendererPreference: string;
      materialBackend: string;
      epoch: number;
    }> = {}
  ) =>
    buildCanvasIdentityKey({
      rendererPreference: overrides.rendererPreference ?? 'webgl',
      materialBackend: overrides.materialBackend ?? 'glsl',
      contextOptions: deriveRendererContextOptions(quality, { devicePixelRatio: 2 }),
      epoch: overrides.epoch ?? 0,
    });

  it('keeps the world alive across medium ↔ high ↔ ultra', () => {
    // The acceptance criterion: a mid-run quality change in this range must not
    // change the key, or Rapier + the treadmill + WASM SWE would be torn down.
    expect(keyFor('medium')).toBe(keyFor('high'));
    expect(keyFor('high')).toBe(keyFor('ultra'));
    expect(keyFor('ultra')).toBe(keyFor('medium'));
  });

  it('still remounts for low, which cannot change antialias on a live context', () => {
    expect(keyFor('low')).not.toBe(keyFor('high'));
  });

  it('remounts when the renderer class or material pipeline changes', () => {
    expect(keyFor('high', { rendererPreference: 'webgpu' })).not.toBe(keyFor('high'));
    expect(keyFor('high', { materialBackend: 'tsl' })).not.toBe(keyFor('high'));
  });

  it('remounts on the context-loss epoch', () => {
    expect(keyFor('high', { epoch: 1 })).not.toBe(keyFor('high', { epoch: 0 }));
  });

  it('carries no quality segment at all', () => {
    // The old key was `…-quality-${qualityPreset}-…`; nothing may reintroduce it.
    for (const preset of ALL_PRESETS) {
      expect(keyFor(preset)).not.toContain('quality');
    }
  });
});
