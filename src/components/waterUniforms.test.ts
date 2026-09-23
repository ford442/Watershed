import * as THREE from 'three';
import {
  getBlackReflectionFallback,
  updateFlowingWaterUniforms,
  type FlowingWaterUniformFrameInput,
  type WaterMaterial,
} from './waterUniforms';

function makeWaterMaterial(): WaterMaterial {
  const material = new THREE.MeshBasicMaterial() as unknown as WaterMaterial;
  material.uniforms = {
    time: { value: 0 },
    flowMap: { value: null },
    sweHeightMap: { value: null },
    reflectionTexture: { value: null },
  };
  return material;
}

const frame: FlowingWaterUniformFrameInput = {
  elapsedTime: 1,
  delta: 1 / 60,
  cameraY: 5,
  biome: 'canyon',
  isNight: false,
  flowMap: null,
  vehiclePos: null,
  vehicleVelocity: null,
  weatherRipple: 0,
  wetness: 0,
  slushiness: 0,
  sunWorldPosition: null,
  isPond: false,
  vortexCenter: null,
  vortexRadius: 10,
  vortexIntensity: 0,
};

describe('updateFlowingWaterUniforms texture slots', () => {
  it('never writes null into a texture uniform (a TSL TextureNode cannot compile without one)', () => {
    const material = makeWaterMaterial();
    updateFlowingWaterUniforms(material, frame);

    // No flow map and no SWE field yet: both fall back to the shared black pixel.
    expect(material.uniforms.flowMap.value).toBe(getBlackReflectionFallback());
    expect(material.uniforms.sweHeightMap.value).toBe(getBlackReflectionFallback());
    expect(material.uniforms.reflectionTexture.value).toBe(getBlackReflectionFallback());
  });

  it('passes a real flow map through', () => {
    const material = makeWaterMaterial();
    const flowMap = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    updateFlowingWaterUniforms(material, { ...frame, flowMap });
    expect(material.uniforms.flowMap.value).toBe(flowMap);
  });
});
