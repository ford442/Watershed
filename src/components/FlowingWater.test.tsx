import type { Mock } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { useThree } from '@react-three/fiber';
import { useShaderLoader } from '../hooks/useShaderLoader';

const shaderMaterialMock = vi.hoisted(() =>
  vi.fn((params: any) => ({ uniforms: params.uniforms, userData: {} } as any)),
);

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    ShaderMaterial: shaderMaterialMock,
  };
});

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: vi.fn(),
}));

vi.mock('../hooks/useShaderLoader', () => ({
  useShaderLoader: vi.fn(),
}));

import * as THREE from 'three';
import FlowingWater from './FlowingWater';

describe('FlowingWater', () => {
  beforeEach(() => {
    shaderMaterialMock.mockImplementation((params: any) => ({
      uniforms: params.uniforms,
      userData: {},
    }));
    (useThree as Mock).mockReturnValue({
      camera: {
        position: new THREE.Vector3(),
      },
    });
    (useShaderLoader as Mock).mockReturnValue({
      code: null,
      loading: false,
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    shaderMaterialMock.mockImplementation((params: any) => ({
      uniforms: params.uniforms,
      userData: {},
    }));
  });

  test('passes custom foam and highlight colors into shader uniforms', () => {
    render(
      <FlowingWater
        geometry={new THREE.BufferGeometry()}
        baseColor="#145d73"
        foamColor="#f0fbff"
        edgeHighlightColor="#9cf2ff"
      />
    );

    expect(shaderMaterialMock).toHaveBeenCalledTimes(1);
    const uniforms = shaderMaterialMock.mock.calls[0][0].uniforms;
    expect(uniforms.foamColor.value.getHexString()).toBe('f0fbff');
    expect(uniforms.edgeHighlight.value.getHexString()).toBe('9cf2ff');
  });

  test('falls back to MeshBasicMaterial when shader setup throws', () => {
    shaderMaterialMock.mockImplementation(() => {
      throw new Error('shader compile failed');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { container } = render(
      <FlowingWater geometry={new THREE.BufferGeometry()} baseColor="#1a7b9c" />
    );

    expect(warnSpy).toHaveBeenCalledWith(
      '[FlowingWater] Shader compile failed, using basic material:',
      'shader compile failed'
    );
    expect(container.querySelector('mesh')).toBeInTheDocument();
  });

  test('uses built-in shader when loaded fragment shader is invalid', () => {
    (useShaderLoader as Mock).mockReturnValue({
      code: 'void broken() {',
      loading: false,
      error: 'invalid shader',
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<FlowingWater geometry={new THREE.BufferGeometry()} />);

    expect(warnSpy).toHaveBeenCalledWith(
      '[FlowingWater] Invalid fragment shader, using built-in fallback'
    );
    expect(shaderMaterialMock).toHaveBeenCalledTimes(1);
    expect(shaderMaterialMock.mock.calls[0][0].fragmentShader).toContain('gl_FragColor = vec4');
    expect(shaderMaterialMock.mock.calls[0][0].fragmentShader).not.toBe('void broken() {');
  });
});
