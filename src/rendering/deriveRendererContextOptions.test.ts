import * as THREE from 'three';
import { QUALITY_SETTINGS } from '../systems/lod/LODManager';
import {
  DEFAULT_TONE_MAPPING_EXPOSURE,
  DESYNCHRONIZED_ENABLED,
  EDITOR_QUALITY_PRESET,
  LOGARITHMIC_DEPTH_BUFFER_ENABLED,
  ULTRA_DPR_CEILING,
  deriveEditorContextOptions,
  deriveRendererContextOptions,
  buildCanvasIdentityKey,
  rendererContextCreationKey,
  resolveCanvasDpr,
  shadowModeToCanvasProp,
  toContextAttributes,
} from './deriveRendererContextOptions';
import {
  CAPTURE_ENVELOPE,
  DEGRADED_ENVELOPE,
  HARDWARE_ENVELOPE,
} from './probeGraphicsCapability';
import type { QualityPreset } from '../systems/GameState';

const ALL_PRESETS: QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

describe('deriveRendererContextOptions', () => {
  it('maps low preset to minimal GPU cost', () => {
    const opts = deriveRendererContextOptions('low');
    expect(opts).toMatchObject({
      dprMax: 1.0,
      shadowMode: 'off',
      shadowMapSize: null,
      outputColorSpace: THREE.SRGBColorSpace,
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: DEFAULT_TONE_MAPPING_EXPOSURE,
    });
  });

  it('maps medium preset to basic shadows and capped DPR', () => {
    const opts = deriveRendererContextOptions('medium');
    expect(opts).toMatchObject({
      dprMax: 1.25,
      shadowMode: 'basic',
      shadowMapSize: 1024,
    });
  });

  it('maps high preset to pre-contract defaults (soft shadows, DPR 2)', () => {
    const opts = deriveRendererContextOptions('high');
    expect(opts).toMatchObject({
      dprMax: 2,
      shadowMode: 'soft',
      shadowMapSize: 2048,
      outputColorSpace: THREE.SRGBColorSpace,
      toneMapping: THREE.ACESFilmicToneMapping,
    });
  });

  it('maps ultra preset to native DPR and larger shadow maps on retina', () => {
    const opts = deriveRendererContextOptions('ultra', { devicePixelRatio: 2 });
    expect(opts).toMatchObject({
      dprMax: 2,
      shadowMode: 'soft',
      shadowMapSize: 4096,
    });
  });

  it('maps ultra preset to 2048 shadow map on 1x displays', () => {
    const opts = deriveRendererContextOptions('ultra', { devicePixelRatio: 1 });
    expect(opts.shadowMapSize).toBe(2048);
    expect(opts.dprMax).toBe(1);
  });

  it('caps ultra DPR at the documented ceiling on high-density displays', () => {
    // Shipping practice is <=2.0 on desktop; 3-4x panels are a fill-rate trap.
    // Move this together with RENDERER.md and the constant, never alone.
    expect(ULTRA_DPR_CEILING).toBe(2.0);
    expect(deriveRendererContextOptions('ultra', { devicePixelRatio: 3 }).dprMax).toBe(
      ULTRA_DPR_CEILING,
    );
    expect(deriveRendererContextOptions('ultra', { devicePixelRatio: 4 }).dprMax).toBe(
      ULTRA_DPR_CEILING,
    );
  });

  it('leaves ultra DPR untouched below the ceiling', () => {
    expect(deriveRendererContextOptions('ultra', { devicePixelRatio: 2 }).dprMax).toBe(2);
    expect(deriveRendererContextOptions('ultra', { devicePixelRatio: 1 }).dprMax).toBe(1);
  });

  it('caps the DPR the Canvas actually resolves, not just the max', () => {
    const opts = deriveRendererContextOptions('ultra', { devicePixelRatio: 3 });
    expect(resolveCanvasDpr(opts.dprMax, 3)).toBe(ULTRA_DPR_CEILING);
  });

  it('still picks the 4096 shadow map on retina even though DPR is capped', () => {
    expect(deriveRendererContextOptions('ultra', { devicePixelRatio: 3 }).shadowMapSize).toBe(4096);
  });

  it('keeps logarithmic depth disabled (evaluated, deferred)', () => {
    expect(LOGARITHMIC_DEPTH_BUFFER_ENABLED).toBe(false);
  });
});

describe('the boot-negotiated envelope owns every creation attribute', () => {
  it.each(ALL_PRESETS)('takes antialias / power / caveat from the envelope on %s', (preset) => {
    expect(deriveRendererContextOptions(preset, { envelope: HARDWARE_ENVELOPE })).toMatchObject({
      antialias: true,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: true,
    });
    expect(deriveRendererContextOptions(preset, { envelope: DEGRADED_ENVELOPE })).toMatchObject({
      antialias: false,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: false,
    });
  });

  it('defaults to the hardware envelope when no probe result is threaded', () => {
    expect(deriveRendererContextOptions('low')).toMatchObject(HARDWARE_ENVELOPE);
  });

  it('lets the capture harness keep antialias with the caveat check off', () => {
    // Visual smoke runs SwiftShader: the caveat check must be off, but flipping
    // antialias would move every baseline.
    const opts = deriveRendererContextOptions('high', { envelope: CAPTURE_ENVELOPE });
    expect(opts.antialias).toBe(true);
    expect(opts.failIfMajorPerformanceCaveat).toBe(false);
  });

  it('never lets the preset move a creation attribute', () => {
    for (const envelope of [HARDWARE_ENVELOPE, DEGRADED_ENVELOPE, CAPTURE_ENVELOPE]) {
      const attributes = ALL_PRESETS.map((preset) =>
        toContextAttributes(deriveRendererContextOptions(preset, { devicePixelRatio: 3, envelope })),
      );
      for (const attrs of attributes) expect(attrs).toEqual(attributes[0]);
    }
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
  const keyFor = (preset: QualityPreset, envelope = HARDWARE_ENVELOPE) =>
    rendererContextCreationKey(
      deriveRendererContextOptions(preset, { devicePixelRatio: 2, envelope }),
    );

  it('is IDENTICAL across all four presets for a given probe result', () => {
    // The acceptance criterion for boot-time negotiation: no quality preset
    // transition may change this key, because a changed key is a Canvas remount
    // and a Canvas remount re-initialises Rapier.
    for (const envelope of [HARDWARE_ENVELOPE, DEGRADED_ENVELOPE, CAPTURE_ENVELOPE]) {
      const keys = ALL_PRESETS.map((preset) => keyFor(preset, envelope));
      expect(new Set(keys).size).toBe(1);
    }
  });

  it('does still separate the envelopes themselves', () => {
    // The remount machinery stays for the one case that needs it: a session
    // negotiated on a different envelope (?softwareGl=1, capture mode).
    expect(keyFor('high', HARDWARE_ENVELOPE)).not.toBe(keyFor('high', DEGRADED_ENVELOPE));
    expect(keyFor('high', HARDWARE_ENVELOPE)).not.toBe(keyFor('high', CAPTURE_ENVELOPE));
  });

  it('carries the power preference, so the negotiated adapter is part of identity', () => {
    expect(keyFor('high', HARDWARE_ENVELOPE)).toContain('power:high-performance');
    expect(keyFor('high', DEGRADED_ENVELOPE)).toContain('power:default');
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
});

describe('deriveEditorContextOptions', () => {
  it('uses the same contract as the game at the high preset', () => {
    const editor = deriveEditorContextOptions({ devicePixelRatio: 1 });
    const game = deriveRendererContextOptions(EDITOR_QUALITY_PRESET, {
      devicePixelRatio: 1,
      envelope: CAPTURE_ENVELOPE,
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

  it('keeps the world alive across every quality transition, low ↔ ultra included', () => {
    const keys = ALL_PRESETS.map((preset) => keyFor(preset));
    expect(new Set(keys).size).toBe(1);
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
