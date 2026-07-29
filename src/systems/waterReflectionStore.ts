/**
 * waterReflectionStore — publishes the planar reflection RT texture to water consumers.
 *
 * WaterReflection (outside Physics) writes; FlowingWater (under TrackSegment) reads in
 * useFrame. Texture identity is stable for a given resolution; clear to null on unmount.
 */

import { create } from 'zustand';
import type { Texture } from 'three';

export interface WaterReflectionState {
  texture: Texture | null;
  strength: number;
  setTexture: (texture: Texture | null) => void;
  setStrength: (strength: number) => void;
  clear: () => void;
}

export const useWaterReflectionStore = create<WaterReflectionState>((set) => ({
  texture: null,
  strength: 0,
  setTexture: (texture) => set({ texture }),
  setStrength: (strength) => set({ strength }),
  clear: () => set({ texture: null, strength: 0 }),
}));
