import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createComposerDriver, type EffectsDriver } from './PostProcessingPipeline';
import {
  AA_TIER_HOLD_FRAMES,
  DEFAULT_POST_TUNING,
  computePostFrameParams,
  createPostSmoothedState,
  type PostAaTier,
  type PostFrameParams,
} from './postProcessing/postFrameParams';
import { qualityToEffects } from '../systems/settings/settingsDerive';
import { smaaPassModule, ssaoPassModule } from './postProcessing/composerPassModules';

type Effect = { enabled: boolean; constructor: { name: string } };

/** Just enough WebGLRenderer for the driver: setEffects + render are recorded. */
function stubRenderer() {
  const gl = {
    toneMapping: THREE.ACESFilmicToneMapping as THREE.ToneMapping,
    outputColorSpace: THREE.SRGBColorSpace as string,
    shadowMap: { autoUpdate: true },
    installed: [] as unknown[][],
    setEffects: vi.fn((effects: unknown[] | null) => {
      gl.installed.push(effects ? [...effects] : []);
    }),
    /** What the chain saw at draw time. */
    draws: [] as Array<{ toneMapping: THREE.ToneMapping; outputColorSpace: string }>,
    render: vi.fn(() => {
      gl.draws.push({ toneMapping: gl.toneMapping, outputColorSpace: gl.outputColorSpace });
    }),
  };
  return gl;
}

function build(gl = stubRenderer()): { driver: EffectsDriver; gl: ReturnType<typeof stubRenderer> } {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  const driver = createComposerDriver(
    gl as unknown as THREE.WebGLRenderer,
    new THREE.Scene(),
    camera,
    1280,
    720,
    DEFAULT_POST_TUNING,
  );
  return { driver, gl };
}

const names = (driver: EffectsDriver) => (driver.effects as unknown as Effect[]).map((e) => e.constructor.name);
const find = (driver: EffectsDriver, name: string) =>
  (driver.effects as unknown as Effect[]).find((e) => e.constructor.name === name);

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

/** A stand-in for three's output target A, as the scene pass receives it. */
function sceneTarget() {
  const target = new THREE.WebGLRenderTarget(64, 64, {
    type: THREE.HalfFloatType,
    depthTexture: new THREE.DepthTexture(64, 64),
  });
  return target;
}

function drawScenePass(driver: EffectsDriver, target: THREE.WebGLRenderTarget) {
  const scenePass = driver.effects[0] as unknown as {
    render: (r: THREE.WebGLRenderer, w: unknown, rb: unknown, d: number, m: boolean) => void;
  };
  const renderer = {
    autoClear: true, autoClearColor: true, autoClearDepth: true, autoClearStencil: true,
    shadowMap: { autoUpdate: true },
    setRenderTarget: () => {}, clear: () => {}, render: () => {},
    getRenderTarget: () => null, getClearColor: (c: THREE.Color) => c, getClearAlpha: () => 1,
  };
  scenePass.render(renderer as unknown as THREE.WebGLRenderer, null, target, 0, false);
}

describe('createComposerDriver (renderer.setEffects, #534 E)', () => {
  it('hands three a chain with the scene pass first and no OutputPass: three grades in its own blit', () => {
    const { driver } = build();
    expect(names(driver)[0]).toBe('SceneRenderPass');
    expect((driver.effects[0] as unknown as { isRenderPass?: boolean }).isRenderPass).toBe(true);
    expect(driver.effects.some((e) => (e as { isOutputPass?: boolean }).isOutputPass)).toBe(false);
    // No in-chain grade until SMAA needs one.
    expect(names(driver)).not.toContain('DisplayTransformPass');
  });

  it('installs its effects on render, re-installs after another driver drew, and clears them on detach / dispose', () => {
    const gl = stubRenderer();
    const live = build(gl).driver;
    live.render();
    live.render();
    expect(gl.setEffects).toHaveBeenCalledTimes(1);
    expect(gl.installed[0]).toEqual([...live.effects]);
    expect(gl.render).toHaveBeenCalledTimes(2);

    // The warm-up's throwaway driver on the same renderer, detached after its draw.
    const warm = build(gl).driver;
    warm.render();
    warm.detach();
    expect(gl.installed.at(-1)).toEqual([]);

    live.render();
    expect(gl.installed.at(-1)).toEqual([...live.effects]);

    live.dispose();
    expect(gl.installed.at(-1)).toEqual([]);
    live.render();
    expect(gl.render).toHaveBeenCalledTimes(4); // 2 live + 1 warm + 1 live; none after dispose
  });

  it('leaves sizing to the renderer: setSize does not touch the chain', () => {
    const { driver, gl } = build();
    driver.setSize(640, 360, 0.5);
    expect(gl.setEffects).not.toHaveBeenCalled();
  });

  it('builds SMAA only once a frame asks for it, behind an in-chain grade, and blits ungraded — #466 Phase C', async () => {
    smaaPassModule.reset();
    const { driver, gl } = build();
    expect(names(driver)).not.toContain('SMAAPass');

    driver.apply(frame('smaa'));
    await smaaPassModule.load();
    driver.apply(frame('smaa'));
    const order = names(driver);
    expect(order.slice(-2)).toEqual(['DisplayTransformPass', 'SMAAPass']);
    expect(find(driver, 'SMAAPass')?.enabled).toBe(true);
    expect(find(driver, 'DisplayTransformPass')?.enabled).toBe(true);

    driver.render();
    // three's blit must be the identity while the chain grades itself, and the grade comes back after.
    expect(gl.draws.at(-1)).toEqual({ toneMapping: THREE.NoToneMapping, outputColorSpace: THREE.LinearSRGBColorSpace });
    expect(gl.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(gl.outputColorSpace).toBe(THREE.SRGBColorSpace);

    const hold = (aa: PostAaTier) => {
      for (let i = 0; i < AA_TIER_HOLD_FRAMES; i++) driver.apply(frame(aa));
    };
    hold('msaa4');
    expect(find(driver, 'SMAAPass')?.enabled).toBe(false);
    expect(find(driver, 'DisplayTransformPass')?.enabled).toBe(false);
    driver.render();
    expect(gl.draws.at(-1)).toEqual({ toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace });
  });

  it('multisamples only the scene target, from the latched tier, and does not reallocate it on a short wobble', () => {
    const { driver } = build();
    const target = sceneTarget();
    const dispose = vi.spyOn(target, 'dispose');

    for (let i = 0; i < AA_TIER_HOLD_FRAMES; i++) driver.apply(frame('msaa4'));
    drawScenePass(driver, target);
    expect(target.samples).toBe(4);
    expect(dispose).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 10; i++) {
      driver.apply(frame(i % 3 === 0 ? 'msaa4' : 'smaa'));
      drawScenePass(driver, target);
    }
    expect(target.samples).toBe(4);
    expect(dispose).toHaveBeenCalledTimes(1);

    for (let i = 0; i < AA_TIER_HOLD_FRAMES; i++) driver.apply(frame('none'));
    drawScenePass(driver, target);
    expect(target.samples).toBe(0);
  });

  it('inserts SSAO right after the scene render once a frame enables it, and not before', async () => {
    ssaoPassModule.reset();
    const { driver, gl } = build();
    expect(names(driver)).not.toContain('SSAOPass');
    driver.render();

    driver.apply(frame('none'));
    await ssaoPassModule.load();
    driver.apply(frame('none'));
    expect(names(driver).slice(0, 2)).toEqual(['SceneRenderPass', 'SSAOPass']);
    // A changed list is handed to three again on the next frame.
    driver.render();
    expect(gl.installed.at(-1)).toEqual([...driver.effects]);

    const off = frame('none');
    driver.apply({ ...off, ssao: { ...off.ssao, enabled: false } });
    expect(find(driver, 'SSAOPass')?.enabled).toBe(false);
  });

  it('god rays write scene + rays opaque and sample the depth the scene pass wrote, whatever buffer they read', () => {
    const { driver } = build();
    const godRays = find(driver, 'GodRaysPass') as unknown as {
      material: THREE.ShaderMaterial;
      render: (r: unknown, w: unknown, rb: unknown) => void;
    };
    expect(godRays.material.blending).toBe(THREE.NoBlending);
    expect(godRays.material.transparent).toBe(false);
    expect(godRays.material.fragmentShader).toMatch(/gl_FragColor = vec4\(base\.rgb \+ rayColor, base\.a\)/);

    const target = sceneTarget();
    drawScenePass(driver, target);
    // Colour from a buffer with no depth (three's target B), depth from the scene pass.
    const colourOnly = new THREE.WebGLRenderTarget(64, 64);
    const renderer = { setRenderTarget: () => {}, clear: () => {}, render: () => {} };
    (godRays as unknown as { fsQuad: { render: () => void } }).fsQuad.render = () => {};
    godRays.render(renderer, new THREE.WebGLRenderTarget(64, 64), colourOnly);
    expect(godRays.material.uniforms.tDiffuse.value).toBe(colourOnly.texture);
    expect(godRays.material.uniforms.tDepth.value).toBe(target.depthTexture);
  });

  it('renders shadow maps once per frame: in the scene pass, not again in SSAO', () => {
    const { driver } = build();
    const scenePass = driver.effects[0] as unknown as {
      render: (r: THREE.WebGLRenderer, w: unknown, rb: unknown, d: number, m: boolean) => void;
    };
    const autoUpdateAtDraw: boolean[] = [];
    const renderer = {
      autoClear: true, autoClearColor: true, autoClearDepth: true, autoClearStencil: true,
      shadowMap: { autoUpdate: true },
      setRenderTarget: () => {},
      clear: () => {},
      render: () => autoUpdateAtDraw.push(renderer.shadowMap.autoUpdate),
    };
    scenePass.render(renderer as unknown as THREE.WebGLRenderer, null, sceneTarget(), 0, false);
    expect(autoUpdateAtDraw).toEqual([true]);
    // Every later scene render in this frame (SSAO's normal pass) skips the shadow update.
    expect(renderer.shadowMap.autoUpdate).toBe(false);
  });

  it('restores shadow auto-update and the grade after the chain, even when a pass throws', async () => {
    smaaPassModule.reset();
    await smaaPassModule.load();
    const gl = stubRenderer();
    const { driver } = build(gl);
    for (let i = 0; i < AA_TIER_HOLD_FRAMES + 1; i++) driver.apply(frame('smaa'));
    gl.render.mockImplementation(() => {
      gl.shadowMap.autoUpdate = false;
      throw new Error('pass failed');
    });
    expect(() => driver.render()).toThrow('pass failed');
    expect(gl.shadowMap.autoUpdate).toBe(true);
    expect(gl.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(gl.outputColorSpace).toBe(THREE.SRGBColorSpace);
  });
});
