/**
 * meander_to_waterfall.ts
 *
 * Segment progression data for the first scripted reach: "The Meander to Waterfall".
 * Consumed by DefaultMapManager via getChunkConfig() in TrackManager.
 *
 * Ranges use "first match wins" semantics — more-specific entries must appear
 * before broader catch-alls. Segments 0–12 are not listed and resolve to
 * DEFAULT_SEGMENT_PROGRESSION (summer, normal, width 35).
 *
 * GLACIER PRELUDE (segments -5 to -1):
 * To start the run in the glacier, set ChunkManager startIndex to GLACIER_START_INDEX.
 * The glacier feeds directly into the meander at segment 0.
 * See LEVEL_DESIGN.md § Glacier Prelude for full details.
 */

import type { SegmentRange } from '../systems/MapSystem';

/** First segment ID of the early-game glacier/alpine prelude. Pass to ChunkManager as startIndex. */
export const GLACIER_START_INDEX = -3;

export const MEANDER_TO_WATERFALL_PROGRESSION: SegmentRange[] = [
    // =========================================================================
    // EARLY GAME: Glacier Ice Run → Alpine Wildflower Stream → The Meander
    // Replaces the old 5-segment glacier prelude stub with two authored sets.
    // =========================================================================

    // Segment -3 — Glacier Ice Run: tight ice chute, slippery, high contrast
    {
        indexFrom: -3,
        indexTo: -3,
        config: {
            biome: 'glacier',
            type: 'normal',
            width: 24,
            waterWidth: 7,
            meanderStrength: 0.2,
            verticalBias: -2.0,
            flowSpeed: 2.2,
            treeDensity: 0.05,
            rockDensity: 'medium',
            slipperiness: 0.9,
            particleCount: 80,
            cameraShake: 0.15,
        },
    },

    // Segments -2 to -1 — Alpine Wildflower Stream: gentle, bright, high flowers
    {
        indexFrom: -2,
        indexTo: -1,
        config: {
            biome: 'summer',
            type: 'normal',
            width: 32,
            waterWidth: 11,
            meanderStrength: 0.9,
            verticalBias: -0.4,
            flowSpeed: 0.8,
            treeDensity: 0.9,
            rockDensity: 'low',
            slipperiness: 0,
            particleCount: 150,
            cameraShake: 0,
        },
    },
    // Segment 13 — Approach: steepens toward the waterfall
    {
        indexFrom: 13,
        config: { meanderStrength: 0.2, verticalBias: -1.2, flowSpeed: 1.15 },
    },
    // Segment 14 — The Waterfall
    {
        indexFrom: 14,
        indexTo: 14,
        config: {
            type: 'waterfall',
            verticalBias: -3,
            meanderStrength: 0,
            forwardMomentum: 0.15,
            particleCount: 400,
            cameraShake: 0.5,
            flowSpeed: 1.6,
            decorations: {
                rocks: [
                    { localX: -13, localZ: -35, scale: 4.0, rotation: 0, rockType: 'slab' },
                ],
            },
            launchShelf: {
                rockRef: { localX: -13, localZ: -35, scale: 4.0 },
                triggerHalfWidth: 9.0,
                triggerHalfLength: 7.0,
                triggerHeight: 6.0,
                triggerDownstreamOffset: 5.5,
                triggerYOffset: 1.0,
            },
        },
    },
    // Segment 15 — Splash Pool / biome transition summer → autumn
    {
        indexFrom: 15,
        config: {
            type: 'splash',
            biome: 'autumn',
            verticalBias: -0.2,
            meanderStrength: 0.5,
            width: 70,
            waterWidth: 18,
            flowSpeed: 0.3,
        },
    },
    // Segments 16–18 — The Pond (wide, calm, autumn)
    {
        indexFrom: 16,
        indexTo: 18,
        config: {
            type: 'pond',
            biome: 'autumn',
            verticalBias: -0.02,
            meanderStrength: 0.3,
            width: 70,
            waterWidth: 28,
            treeDensity: 0.3,
            flowSpeed: 0.45,
        },
    },
    // Segments 20–21 — Slot Canyon (narrow, high rock density)
    // Must be listed before the 19+ catch-all so it takes precedence.
    {
        indexFrom: 20,
        indexTo: 21,
        config: {
            biome: 'slotCanyon',
            width: 24,
            waterWidth: 8,
            meanderStrength: 0.55,
            verticalBias: -0.95,
            flowSpeed: 1.3,
            treeDensity: 0.08,
            rockDensity: 'high',
        },
    },
    // Segment 22 — Slot canyon exit pillar formation
    {
        indexFrom: 22,
        indexTo: 22,
        config: {
            biome: 'slotCanyon',
            width: 24,
            waterWidth: 8,
            meanderStrength: 0.55,
            verticalBias: -0.95,
            flowSpeed: 1.3,
            treeDensity: 0.08,
            rockDensity: 'high',
            decorations: {
                rocks: [
                    { localX: 10, localZ: 0, scale: 2.2, rotation: 0, rockType: 'column' },
                    { localX: 11.5, localZ: 8, scale: 1.8, rotation: 0.4, rockType: 'column' },
                    { localX: 9, localZ: -12, scale: 2.0, rotation: -0.3, rockType: 'column' },
                ],
            },
        },
    },
    // Segments 23–27 — Downhill Creek Run (fast mossy slot creek)
    {
        indexFrom: 23,
        indexTo: 27,
        config: {
            biome: 'summer',
            type: 'normal',
            width: 28,
            waterWidth: 9,
            verticalBias: -1.5,
            meanderStrength: 0.6,
            flowSpeed: 1.4,
            treeDensity: 0.6,
            rockDensity: 'high',
        },
    },
    // Segment 28 — Drop-off Ledge (pre-waterfall steepening)
    {
        indexFrom: 28,
        indexTo: 28,
        config: {
            biome: 'summer',
            type: 'normal',
            width: 22,
            waterWidth: 7,
            verticalBias: -2.2,
            meanderStrength: 0.1,
            flowSpeed: 1.5,
            rockDensity: 'high',
            cameraShake: 0.2,
        },
    },
    // Segment 29 — Second Waterfall (wide fanning curtain)
    {
        indexFrom: 29,
        indexTo: 29,
        config: {
            biome: 'summer',
            type: 'waterfall',
            width: 40,
            waterWidth: 14,
            verticalBias: -3.0,
            meanderStrength: 0,
            forwardMomentum: 0.12,
            particleCount: 600,
            cameraShake: 0.7,
            flowSpeed: 2.0,
        },
    },
    // Segment 30 — Plunge Pool (autumn transition, calm swirl)
    {
        indexFrom: 30,
        indexTo: 30,
        config: {
            biome: 'autumn',
            type: 'splash',
            width: 75,
            waterWidth: 22,
            verticalBias: -0.1,
            meanderStrength: 0.4,
            flowSpeed: 0.25,
            treeDensity: 0.8,
            rockDensity: 'low',
        },
    },
    // Segments 31–32 — Delta Approach (widening, mist on, reduced rocks)
    {
        indexFrom: 31,
        indexTo: 32,
        config: {
            biome: 'autumn',
            type: 'normal',
            width: 80,
            waterWidth: 20,
            verticalBias: -0.1,
            meanderStrength: 0.4,
            flowSpeed: 0.5,
            rockDensity: 'low',
            treeDensity: 0.5,
        },
    },
    // Segments 33–34 — Delta Entry (transition to delta, calm, willows, no rocks)
    {
        indexFrom: 33,
        indexTo: 34,
        config: {
            biome: 'delta',
            type: 'normal',
            width: 90,
            waterWidth: 30,
            verticalBias: 0,
            meanderStrength: 0.2,
            flowSpeed: 0.35,
            rockDensity: 'low',
            treeDensity: 0.6,
        },
    },
    // Segments 35–36 — Wide Delta (mirror-flat, bird flocks, reed banks)
    {
        indexFrom: 35,
        indexTo: 36,
        config: {
            biome: 'delta',
            type: 'normal',
            width: 100,
            waterWidth: 35,
            verticalBias: 0,
            meanderStrength: 0.1,
            flowSpeed: 0.25,
            rockDensity: 'low',
            treeDensity: 0.4,
        },
    },
    // Segment 37 — Final Stretch (current nearly zero, thick sunset fog)
    {
        indexFrom: 37,
        indexTo: 37,
        config: {
            biome: 'delta',
            type: 'normal',
            width: 110,
            waterWidth: 38,
            verticalBias: 0,
            meanderStrength: 0.05,
            flowSpeed: 0.15,
            rockDensity: 'low',
            treeDensity: 0.3,
        },
    },
    // Segment 38 — Journey Complete trigger
    {
        indexFrom: 38,
        indexTo: 38,
        config: {
            biome: 'delta',
            type: 'normal',
            width: 110,
            waterWidth: 38,
            verticalBias: 0,
            meanderStrength: 0,
            flowSpeed: 0.1,
            rockDensity: 'low',
            treeDensity: 0.2,
            journeyComplete: true,
        },
    },
    // Segments 19+ catch-all — Autumn Rapids (open-ended, covers 19 and 39+)
    {
        indexFrom: 19,
        indexTo: 30,
        config: {
            biome: 'autumn',
            verticalBias: -0.7,
            meanderStrength: 1.5,
            rockDensity: 'high',
            flowSpeed: 1.15,
        },
    },
];

/**
 * Minimal second-map stub used to prove the authored-map handoff contract.
 * This is intentionally short and delta-focused; future authored content can
 * replace the progression without changing the TrackManager handoff plumbing.
 */
export const DELTA_RAPIDS_CONTINUED_START_INDEX = 0;

export const DELTA_RAPIDS_CONTINUED_PROGRESSION: SegmentRange[] = [
    {
        indexFrom: 0,
        indexTo: 2,
        config: {
            biome: 'delta',
            type: 'pond',
            width: 115,
            waterWidth: 42,
            verticalBias: -0.02,
            meanderStrength: 0.25,
            flowSpeed: 0.25,
            rockDensity: 'low',
            treeDensity: 0.25,
        },
    },
    {
        indexFrom: 3,
        indexTo: 5,
        config: {
            biome: 'delta',
            type: 'normal',
            width: 85,
            waterWidth: 30,
            verticalBias: -0.35,
            meanderStrength: 0.8,
            flowSpeed: 0.9,
            rockDensity: 'medium',
            treeDensity: 0.35,
            particleCount: 120,
        },
    },
    {
        indexFrom: 6,
        indexTo: 7,
        config: {
            biome: 'autumn',
            type: 'normal',
            width: 62,
            waterWidth: 22,
            verticalBias: -0.55,
            meanderStrength: 1.2,
            flowSpeed: 1.15,
            rockDensity: 'high',
            treeDensity: 0.55,
            particleCount: 220,
            cameraShake: 0.12,
        },
    },
    {
        indexFrom: 8,
        indexTo: 8,
        config: {
            biome: 'delta',
            type: 'splash',
            width: 100,
            waterWidth: 36,
            verticalBias: -0.08,
            meanderStrength: 0.1,
            flowSpeed: 0.35,
            rockDensity: 'low',
            treeDensity: 0.2,
            journeyComplete: true,
        },
    },
];
