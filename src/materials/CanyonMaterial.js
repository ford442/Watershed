/**
 * CanyonMaterial facade — factory API backed by CanyonNodeMaterial (TSL / NodeMaterial).
 */
import {
  createCanyonNodeMaterial,
  updateCanyonNodeMaterial,
  createFallbackCanyonMaterial,
} from './CanyonNodeMaterial';

export function createCanyonMaterial(options = {}) {
  return createCanyonNodeMaterial(options);
}

export function updateCanyonMaterial(material, deltaTime, elapsedTime) {
  return updateCanyonNodeMaterial(material, deltaTime, elapsedTime);
}

export { createFallbackCanyonMaterial };

export default createCanyonMaterial;
