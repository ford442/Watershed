import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as THREE from 'three';
import FlowingWater from './FlowingWater';

jest.mock('@react-three/fiber', () => ({
  useFrame: jest.fn(),
}));

describe('FlowingWater', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('passes custom foam and highlight colors into shader uniforms', () => {
    const shaderMaterialSpy = jest
      .spyOn(THREE, 'ShaderMaterial')
      .mockImplementation((params: any) => ({ uniforms: params.uniforms } as any));

    render(
      <FlowingWater
        geometry={new THREE.BufferGeometry()}
        baseColor="#145d73"
        foamColor="#f0fbff"
        edgeHighlightColor="#9cf2ff"
      />
    );

    expect(shaderMaterialSpy).toHaveBeenCalledTimes(1);
    const uniforms = shaderMaterialSpy.mock.calls[0][0].uniforms;
    expect(uniforms.foamColor.value.getHexString()).toBe('f0fbff');
    expect(uniforms.edgeHighlight.value.getHexString()).toBe('9cf2ff');
  });

  test('falls back to MeshBasicMaterial when shader setup throws', () => {
    jest.spyOn(THREE, 'ShaderMaterial').mockImplementation(() => {
      throw new Error('shader compile failed');
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { container } = render(
      <FlowingWater geometry={new THREE.BufferGeometry()} baseColor="#1a7b9c" />
    );

    expect(warnSpy).toHaveBeenCalledWith(
      '[FlowingWater] Shader error, falling back to basic material:',
      expect.any(Error)
    );
    expect(container.querySelector('mesh')).toBeInTheDocument();
  });
});
