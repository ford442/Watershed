import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import FlowingWater from './FlowingWater';
import { useShaderLoader } from '../hooks/useShaderLoader';

jest.mock('@react-three/fiber', () => ({
  useFrame: jest.fn(),
  useThree: jest.fn(),
}));

jest.mock('../hooks/useShaderLoader', () => ({
  useShaderLoader: jest.fn(),
}));

describe('FlowingWater', () => {
  beforeEach(() => {
    (useThree as jest.Mock).mockReturnValue({
      camera: {
        position: new THREE.Vector3(),
      },
    });
    (useShaderLoader as jest.Mock).mockReturnValue({
      code: null,
      loading: false,
      error: null,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('passes custom foam and highlight colors into shader uniforms', () => {
    const shaderMaterialSpy = jest
      .spyOn(THREE, 'ShaderMaterial')
      .mockImplementation((params: any) => ({ uniforms: params.uniforms, userData: {} } as any));

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

  test('uses built-in shader when loaded fragment shader is invalid', () => {
    (useShaderLoader as jest.Mock).mockReturnValue({
      code: 'void broken() {',
      loading: false,
      error: 'invalid shader',
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const shaderMaterialSpy = jest
      .spyOn(THREE, 'ShaderMaterial')
      .mockImplementation((params: any) => ({ uniforms: params.uniforms, userData: {} } as any));

    render(<FlowingWater geometry={new THREE.BufferGeometry()} />);

    expect(warnSpy).toHaveBeenCalledWith(
      '[FlowingWater] Invalid fragment shader, using built-in fallback'
    );
    expect(shaderMaterialSpy).toHaveBeenCalledTimes(1);
    expect(shaderMaterialSpy.mock.calls[0][0].fragmentShader).toContain('gl_FragColor = vec4');
    expect(shaderMaterialSpy.mock.calls[0][0].fragmentShader).not.toBe('void broken() {');
  });
});
