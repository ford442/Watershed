import * as THREE from 'three';
import { qualityToEffects } from '../../systems/settings/settingsDerive';
import { createNodePostPipeline, nodePostStructureKey, type NodePostStructure } from './nodePostPipeline';
import { DEFAULT_POST_TUNING, computePostFrameParams, createPostSmoothedState } from './postFrameParams';

const made = vi.hoisted(() => ({ bloom: 0, ao: 0, disposed: 0 }));

vi.mock('three/examples/jsm/tsl/display/BloomNode.js', () => ({
  bloom: () => {
    made.bloom += 1;
    return { rgb: {}, dispose: () => (made.disposed += 1) };
  },
}));
vi.mock('three/examples/jsm/tsl/display/DenoiseNode.js', () => ({
  denoise: () => ({ r: {}, dispose: () => (made.disposed += 1) }),
}));
vi.mock('three/examples/jsm/tsl/display/GTAONode.js', () => ({
  ao: () => {
    made.ao += 1;
    return { resolutionScale: 1, getTextureNode: () => ({ r: {} }), dispose: () => (made.disposed += 1) };
  },
}));

const ALL: NodePostStructure = { bloom: true, ssao: true, godRays: true, chromatic: true };

function makePipeline(structure: NodePostStructure = ALL) {
  // The RenderPipeline double never touches the renderer; no GL context needed.
  const renderer = { isWebGPURenderer: true };
  return createNodePostPipeline(renderer as never, new THREE.Scene(), new THREE.PerspectiveCamera(), structure);
}

beforeEach(() => {
  made.bloom = 0;
  made.ao = 0;
  made.disposed = 0;
});

describe('createNodePostPipeline', () => {
  it('builds only the expensive passes the structure asks for', () => {
    makePipeline({ bloom: true, ssao: false, godRays: false, chromatic: false });
    expect(made.bloom).toBe(1);
    expect(made.ao).toBe(0);
  });

  it('rebuilds the graph only when the structure changes', () => {
    const post = makePipeline();
    expect(made.bloom).toBe(1);
    expect(post.setStructure(ALL)).toBe(false);
    expect(made.bloom).toBe(1);

    post.pipeline.needsUpdate = false;
    expect(post.setStructure({ ...ALL, ssao: false })).toBe(true);
    // Old bloom + GTAO + its denoise disposed, a fresh bloom built, no new GTAO.
    expect(made.disposed).toBe(3);
    expect(made.bloom).toBe(2);
    expect(made.ao).toBe(1);
    expect(post.pipeline.needsUpdate).toBe(true);
  });

  it('accepts a frame of shared post params and renders through the pipeline', () => {
    const post = makePipeline();
    const camera = new THREE.PerspectiveCamera();
    const params = computePostFrameParams(
      {
        delta: 1 / 60,
        elapsed: 1,
        velocity: 10,
        waterfallIntensity: 0.5,
        isTightCanyon: true,
        biomeId: 'slotCanyon',
        weatherType: 'clear',
        timeOfDay: 0.5,
        sunWorldPosition: new THREE.Vector3(0, 30, -100),
        camera,
        quality: 'high',
        enableGodRays: true,
        volumetricSamples: 48,
        effectPresence: qualityToEffects('high'),
        isRunner: true,
        sprintStamina: 1,
        boostActive: 0,
        boostIntensity: 0,
        aspectRatio: 16 / 9,
      },
      DEFAULT_POST_TUNING,
      createPostSmoothedState(),
    );
    expect(() => post.update(params)).not.toThrow();
    post.render();
    expect((post.pipeline as unknown as { renderCount: number }).renderCount).toBe(1);
    post.dispose();
  });

  it('keys structures stably', () => {
    expect(nodePostStructureKey(ALL)).toBe('1111');
    expect(nodePostStructureKey({ bloom: false, ssao: true, godRays: false, chromatic: true })).toBe('0101');
  });
});
