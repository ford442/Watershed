import * as THREE from 'three';
import { isAutumnLike, isSummerLike } from '../../configs/biomes';

// Simple seeded random function
export const seededRandom = (seed) => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
};

export const TREE_SPECIES = ['conifer', 'broadleaf', 'birch', 'snag'];
export const FLOWER_VARIANTS = ['bloom', 'spike', 'daisy', 'bell'];
export const ROCK_TYPES = ['boulder', 'slab', 'column'];

export const pickTreeSpecies = ({ biomeProfile, biome, isRim, type, segmentId, instanceIndex }) => {
    const weights = biomeProfile.treeSpeciesWeights[isRim ? 'rim' : 'floor'];
    const speciesWeights = { ...weights };

    if (type === 'waterfall' || type === 'splash') {
        speciesWeights.snag += isRim ? 0.2 : 0.12;
        speciesWeights.broadleaf *= 0.75;
    }

    if (isSummerLike(biome) && !isRim) {
        speciesWeights.conifer += 0.08;
    }

    const total = TREE_SPECIES.reduce((sum, species) => sum + Math.max(0, speciesWeights[species] || 0), 0);
    if (total <= 0) {
        return { species: 'conifer', speciesIndex: 0 };
    }

    const roll = seededRandom(segmentId * 137 + instanceIndex * 97 + (isRim ? 53 : 11)) * total;
    let cursor = 0;
    for (let i = 0; i < TREE_SPECIES.length; i++) {
        const species = TREE_SPECIES[i];
        cursor += Math.max(0, speciesWeights[species] || 0);
        if (roll <= cursor) {
            return { species, speciesIndex: i };
        }
    }

    return { species: 'conifer', speciesIndex: 0 };
};

export const createFlowerPayload = ({ position, rotation, scale, biome, segmentId, instanceIndex }) => {
    const variantIndex = Math.floor(seededRandom(segmentId * 137 + instanceIndex * 71 + 23) * FLOWER_VARIANTS.length);
    return {
        position,
        rotation,
        scale,
        variant: FLOWER_VARIANTS[variantIndex],
        variantIndex,
        colorIndex: Math.floor(seededRandom(segmentId * 137 + instanceIndex * 89 + 31) * 6),
        hueJitter: seededRandom(segmentId * 137 + instanceIndex * 113 + 7) - 0.5,
        lightnessJitter: seededRandom(segmentId * 137 + instanceIndex * 131 + (isAutumnLike(biome) ? 41 : 17)) - 0.5,
    };
};

export const createRockPayload = ({ position, rotation, scale, biome, segmentId, instanceIndex, isScatter = false, nearWall = false, rockTypeOverride = null, crumbling = false }) => {
    let rockType = 'boulder';

    if (rockTypeOverride && ROCK_TYPES.includes(rockTypeOverride)) {
        rockType = rockTypeOverride;
    } else if (biome === 'slotCanyon') {
        const roll = seededRandom(segmentId * 137 + instanceIndex * 59 + (isScatter ? 17 : 7));
        rockType = roll > 0.68 ? 'column' : roll > 0.36 ? 'slab' : 'boulder';
    } else if (nearWall) {
        rockType = seededRandom(segmentId * 137 + instanceIndex * 47 + 13) > 0.58 ? 'slab' : 'boulder';
    }

    const shadePalette = isAutumnLike(biome)
        ? ['#8b7355', '#9f7b55', '#74563e']
        : biome === 'slotCanyon'
            ? ['#a65f3a', '#bf7444', '#8d4c2b']
            : ['#8f8576', '#9d8b78', '#6f675d'];

    const color = shadePalette[Math.floor(seededRandom(segmentId * 137 + instanceIndex * 83 + 29) * shadePalette.length)];
    const scaled = isScatter
        ? scale.clone().multiplyScalar(0.35 + seededRandom(segmentId * 137 + instanceIndex * 97 + 5) * 0.35)
        : scale;

    return {
        position,
        rotation,
        scale: scaled,
        rockType: ROCK_TYPES.includes(rockType) ? rockType : 'boulder',
        color,
        ...(crumbling ? { crumbling: true, segmentId, pillarIndex: instanceIndex } : {}),
    };
};

export const lerpValue = (a, b, t) => a + (b - a) * t;

export const smoothNoise = (seed) => {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
};

export const SLOT_CANYON_STRATA = {
    bedrockColor: new THREE.Color('#5b2f1f'),
    sedimentaryColor: new THREE.Color('#8f4d2d'),
    graniteColor: new THREE.Color('#bf7444'),
};

export const hasFiniteCoordinates = (point) => (
    point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && Number.isFinite(point.z)
);
