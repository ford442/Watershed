import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createComposerDriver } from './PostProcessingPipeline';
import {
  DEFAULT_POST_TUNING,
  computePostFrameParams,
  createPostSmoothedState,
  type PostAaTier,
  type PostFrameParams,
} from './postProcessing/postFrameParams';
import { qualityToEffects } from '../systems/settings/settingsDerive';

/** Just enough WebGLRenderer for EffectComposer's constructor and setSize. */
function stubRenderer(width = 1280, height = 720, pixelRatio = 1): THREE.WebGLRenderer {
  return {
    getSize: (target: THREE.Vector2) => target.set(width, height),
    getPixelRatio: () => pixelRatio,
  } as unknown as THREE.WebGLRenderer;
}

function build() {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  return createComposerDriver(stubRenderer(), new THREE.Scene(), camera, 1280, 720, DEFAULT_POST_TUNING);
}

describe('createComposerDriver', () => {
  it('ends the chain with the one output transform (tone-map + sRGB) — #466 Phase A', () => {
    const { composer } = build();
    const passes = composer.passes as Array<{ enabled: boolean; isOutputPass?: boolean }>;
    // SMAA (Phase C) is off until apply() picks a tier.
    const enabled = passes.filter((pass) => pass.enabled);
    expect(enabled[enabled.length - 1].isOutputPass).toBe(true);
    expect(passes.filter((pass) => pass.isOutputPass)).toHaveLength(1);
  });

  it('sizes its targets to CSS size × DPR, so the render-scale valve shrinks the scene render — #466 Phase B', () => {
    const driver = build();
    driver.setSize(1280, 720, 1);
    expect(driver.composer.renderTarget1.width).toBe(1280);

    // A valve at 0.5 reaches the composer as DPR 0.5 (RendererQualitySync → setDpr).
    driver.setSize(1280, 720, 0.5);
    for (const target of [driver.composer.renderTarget1, driver.composer.renderTarget2]) {
      expect(target.width).toBe(640);
      expect(target.height).toBe(360);
    }
  });

  function frame(aa: PostAaTier): PostFrameParams {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
    const params = computePostFrameParams(
      {
        delta: 1 / 60, elapsed: 1, velocity: 0, waterfallIntensity: 0, isTightCanyon: false,
        biomeId: 'canyonSummer', weatherType: 'clear', timeOfDay: 0.5,
        sunWorldPosition: new THREE.Vector3(0, 30, -100), camera, quality: 'high',
        enableGodRays: false, volumetricSamples: 16, effectPresence: qualityToEffects('high'),
        isRunner: true, sprintStamina: 1, boostActive: 0, boostIntensity: 0, aspectRatio: 16 / 9,
      },
      DEFAULT_POST_TUNING,
      createPostSmoothedState(),
    );
    return { ...params, aa };
  }

  it('switches the AA tier live: SMAA after the output pass, or 4x MSAA targets — #466 Phase C', () => {
    const driver = build();
    const passes = driver.composer.passes as Array<{ enabled: boolean; isOutputPass?: boolean; constructor: { name: string } }>;
    const smaa = passes[passes.length - 1];
    expect(smaa.constructor.name).toBe('SMAAPass');
    expect(passes[passes.length - 2].isOutputPass).toBe(true);

    driver.apply(frame('smaa'));
    expect(smaa.enabled).toBe(true);
    expect(driver.composer.renderTarget1.samples).toBe(0);

    driver.apply(frame('msaa4'));
    expect(smaa.enabled).toBe(false);
    expect(driver.composer.renderTarget1.samples).toBe(4);
    expect(driver.composer.renderTarget2.samples).toBe(4);

    driver.apply(frame('none'));
    expect(smaa.enabled).toBe(false);
    expect(driver.composer.renderTarget1.samples).toBe(0);
  });

  it('samples a 24-bit depth texture', () => {
    const { composer } = build();
    expect(composer.renderTarget1.depthTexture?.type).toBe(THREE.UnsignedIntType);
  });
});
