import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createComposerDriver } from './PostProcessingPipeline';
import { DEFAULT_POST_TUNING } from './postProcessing/postFrameParams';

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
    const enabled = passes.filter((pass) => pass.enabled);
    expect(enabled[enabled.length - 1].isOutputPass).toBe(true);
    expect(passes.filter((pass) => pass.isOutputPass)).toHaveLength(1);
  });
});
