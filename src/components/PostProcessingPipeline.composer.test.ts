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
import { smaaPassModule, ssaoPassModule } from './postProcessing/composerPassModules';

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

  it('builds SMAA only once a frame asks for it, then switches the AA tier live: SMAA after the output pass, or 4x MSAA targets — #466 Phase C', async () => {
    smaaPassModule.reset();
    const driver = build();
    const passes = driver.composer.passes as Array<{ enabled: boolean; isOutputPass?: boolean; constructor: { name: string } }>;
    // The SMAA code is a lazy chunk: no pass (and no fetch) until a frame wants SMAA.
    expect(passes.some((pass) => pass.constructor.name === 'SMAAPass')).toBe(false);

    driver.apply(frame('smaa'));
    await smaaPassModule.load();
    driver.apply(frame('smaa'));
    const smaa = passes[passes.length - 1];
    expect(smaa.constructor.name).toBe('SMAAPass');
    expect(passes[passes.length - 2].isOutputPass).toBe(true);
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

  it('inserts SSAO right after the scene render once a frame enables it, and not before', async () => {
    ssaoPassModule.reset();
    const driver = build();
    const names = () => (driver.composer.passes as Array<{ constructor: { name: string } }>).map((pass) => pass.constructor.name);
    expect(names()).not.toContain('SSAOPass');

    driver.apply(frame('none'));
    await ssaoPassModule.load();
    driver.apply(frame('none'));
    expect(names().slice(0, 2)).toEqual(['SceneRenderPass', 'SSAOPass']);

    const off = frame('none');
    driver.apply({ ...off, ssao: { ...off.ssao, enabled: false } });
    const ssao = (driver.composer.passes as Array<{ enabled: boolean; constructor: { name: string } }>)[1];
    expect(ssao.enabled).toBe(false);
  });

  it('god rays write scene + rays opaque, never blend onto the stale ping-pong target', () => {
    const { composer } = build();
    const godRays = (composer.passes as Array<{ constructor: { name: string }; material?: THREE.ShaderMaterial }>)
      .find((pass) => pass.constructor.name === 'GodRaysPass');
    expect(godRays?.material?.blending).toBe(THREE.NoBlending);
    expect(godRays?.material?.transparent).toBe(false);
    expect(godRays?.material?.fragmentShader).toMatch(/gl_FragColor = vec4\(base\.rgb \+ rayColor, base\.a\)/);
  });

  it('renders shadow maps once per frame: in the scene pass, not again in SSAO', () => {
    const driver = build();
    const scenePass = driver.composer.passes[0] as unknown as {
      render: (r: THREE.WebGLRenderer, w: unknown, rb: unknown, d: number, m: boolean) => void;
    };
    const autoUpdateAtDraw: boolean[] = [];
    const renderer = {
      autoClear: true,
      autoClearColor: true,
      autoClearDepth: true,
      autoClearStencil: true,
      shadowMap: { autoUpdate: true },
      setRenderTarget: () => {},
      clear: () => {},
      render: () => autoUpdateAtDraw.push(renderer.shadowMap.autoUpdate),
    };
    scenePass.render(renderer as unknown as THREE.WebGLRenderer, null, null, 0, false);
    expect(autoUpdateAtDraw).toEqual([true]);
    // Every later scene render in this frame (SSAO's normal pass) skips the shadow update.
    expect(renderer.shadowMap.autoUpdate).toBe(false);
  });

  it('restores shadow auto-update after the chain, even when a pass throws', () => {
    const gl = { ...stubRenderer(), shadowMap: { autoUpdate: true } } as unknown as THREE.WebGLRenderer;
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
    const driver = createComposerDriver(gl, new THREE.Scene(), camera, 1280, 720, DEFAULT_POST_TUNING);
    driver.composer.render = () => {
      gl.shadowMap.autoUpdate = false;
      throw new Error('pass failed');
    };
    expect(() => driver.render()).toThrow('pass failed');
    expect(gl.shadowMap.autoUpdate).toBe(true);
  });

  it('samples a 24-bit depth texture', () => {
    const { composer } = build();
    expect(composer.renderTarget1.depthTexture?.type).toBe(THREE.UnsignedIntType);
  });
});
