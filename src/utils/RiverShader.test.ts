import * as THREE from 'three';
import { extendRiverMaterial } from './RiverShader';

describe('extendRiverMaterial', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('guards vertex color tinting when USE_COLOR is disabled', () => {
    const material = new THREE.MeshStandardMaterial();
    extendRiverMaterial(material);

    const shader = {
      uniforms: {},
      vertexShader: `
        void main() {
          #include <begin_vertex>
        }
      `,
      fragmentShader: `
        void main() {
          #include <map_fragment>
          #include <color_fragment>
          gl_FragColor = vec4(1.0);
        }
      `,
    };

    expect(() => material.onBeforeCompile(shader as any)).not.toThrow();
    // Vertex colour handling stays in #include <color_fragment> (the proper
    // Three.js chunk) rather than being duplicated in our custom injection.
    expect(shader.fragmentShader).toContain('#include <color_fragment>');
    expect(material.userData.shader).toBe(shader);
    expect(material.userData.shaderFailed).toBe(false);
  });

  test('falls back safely when shader markers are missing', () => {
    const material = new THREE.MeshStandardMaterial({ color: '#808080', roughness: 0.9 });
    extendRiverMaterial(material);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    material.onBeforeCompile({
      uniforms: {},
      vertexShader: 'void main() { gl_Position = vec4(1.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
    } as any);

    expect(errorSpy).toHaveBeenCalledWith(
      'RiverShader: Error compiling shader injection:',
      expect.any(Error)
    );
    expect(material.userData.shaderFailed).toBe(true);
    expect(material.userData.shader).toBeNull();
  });
});
