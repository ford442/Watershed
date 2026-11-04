import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { shaderWarmupRecipes } from './shaderWarmupRecipes';

describe('shaderWarmupRecipes', () => {
  it('builds every GLSL recipe without throwing', () => {
    for (const recipe of shaderWarmupRecipes('glsl')) {
      expect(() => recipe.build(), recipe.id).not.toThrow();
    }
  });

  it('keys the floor and wall river variants apart (one shared key used to mean one shared program)', () => {
    const recipes = shaderWarmupRecipes('glsl');
    const keyOf = (id: string) => {
      const mesh = recipes.find((r) => r.id === id)!.build() as THREE.Mesh;
      return (mesh.material as THREE.Material).customProgramCacheKey();
    };
    expect(keyOf('canyon-floor')).not.toBe(keyOf('canyon-wall'));
  });
});
