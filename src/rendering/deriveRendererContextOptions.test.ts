import * as THREE from 'three';
import { QUALITY_SETTINGS } from '../systems/LODManager';
import {
  DEFAULT_TONE_MAPPING_EXPOSURE,
  LOGARITHMIC_DEPTH_BUFFER_ENABLED,
  deriveRendererContextOptions,
  resolveCanvasDpr,
  shadowModeToCanvasProp,
} from './deriveRendererContextOptions';

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
