/**
 * meander_to_waterfall.ts
 *
 * Segment progression data for the first scripted reach: "The Meander to Waterfall".
 * Consumed by DefaultMapManager via getChunkConfig() in TrackManager.
 *
 * Ranges use "first match wins" semantics — more-specific entries must appear
 * before broader catch-alls. Segments 0–12 are not listed and resolve to
 * DEFAULT_SEGMENT_PROGRESSION (summer, normal, width 35).
 */

import type { SegmentRange } from '../systems/MapSystem';

export const MEANDER_TO_WATERFALL_PROGRESSION: SegmentRange[] = [
    // Segment 13 — Approach: steepens toward the waterfall
    {
        indexFrom: 13,
        config: { meanderStrength: 0.2, verticalBias: -1.2, flowSpeed: 1.15 },
    },
    // Segment 14 — The Waterfall
    {
        indexFrom: 14,
        config: {
            type: 'waterfall',
            verticalBias: -3,
            meanderStrength: 0,
            forwardMomentum: 0.15,
            particleCount: 400,
            cameraShake: 0.5,
            flowSpeed: 1.6,
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
    // Segments 20–22 — Slot Canyon (narrow, high rock density)
    // Must be listed before the 19+ catch-all so it takes precedence.
    {
        indexFrom: 20,
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
    // Segments 19+ catch-all — Autumn Rapids (open-ended, covers 19 and 31+)
    {
        indexFrom: 19,
        config: {
            biome: 'autumn',
            verticalBias: -0.7,
            meanderStrength: 1.5,
            rockDensity: 'high',
            flowSpeed: 1.15,
        },
    },
];
