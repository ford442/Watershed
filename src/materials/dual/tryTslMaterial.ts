import type { MaterialBackend } from '../../rendering/materialBackend';
import { getLoadedNodeMaterials } from '../nodeMaterials';

export function tryTslMaterial<T>(
  backend: MaterialBackend,
  build: () => T,
  fallback: () => T,
  label: string,
  warned: { current: boolean },
): { value: T; backend: MaterialBackend } {
  if (backend !== 'tsl' || !getLoadedNodeMaterials()) {
    return { value: fallback(), backend: 'glsl' };
  }
  try {
    return { value: build(), backend: 'tsl' };
  } catch (error) {
    if (!warned.current) {
      warned.current = true;
      console.warn(`[${label}] TSL material failed to build; falling back to GLSL.`, error);
    }
    return { value: fallback(), backend: 'glsl' };
  }
}
