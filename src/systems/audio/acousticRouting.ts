/**
 * acousticRouting.ts — AudioManager's canyon acoustics routing.
 *
 * Owns the walls' acoustic state (on/off, tightness, surface wetness), the set
 * of playing layers that follow it, and the Web Audio filter chain each one
 * gets: canyon sends (canyonAcoustics.ts decides the numbers, this builds the
 * nodes) plus the survival wetness muffle. A wall change re-routes every
 * layer; the synthetic impulse responses are cached per 50 ms of decay.
 */

import * as THREE from 'three';
import { currentWetnessMuffle } from './wetnessMuffle';
import { canyonAcousticParams, DEFAULT_WALL_WETNESS } from './canyonAcoustics';
import { createRng } from '../../math/random';

/** This module's seeded stream (#503 A): draws are reproducible run to run. */
const random = createRng(0xa1c12f5b);

/**
 * Which acoustic treatment a routed layer gets. Only the rapids stem carries
 * early reflections — putting them on every bed smears the whole mix, and the
 * roar is what the walls are actually throwing back.
 */
export type AcousticStem = 'rapids' | 'bed';

export type RoutableAudio = THREE.Audio<AudioNode> | THREE.PositionalAudio;

/**
 * Lowpass frequency for the wetness muffle, or null when dry enough that a
 * filter node is not worth inserting.
 */
export function wetnessCutoffHz(): number | null {
  const muffle = currentWetnessMuffle();
  return muffle.wet > 0.02 ? muffle.cutoffHz : null;
}

export interface AcousticRouter {
  /** See AudioManager.enableCanyonAcoustics — inputs are clamped; a no-op when unchanged. */
  enable(wallTightness: number, wallWetness: number): void;
  disable(): void;
  /** Live wall tightness (0 when acoustics are off). */
  wallTightness(): number;
  /** Follow canyon acoustics (re-routed on every wall change) until `unroute`. */
  route(source: RoutableAudio, stem: AcousticStem): void;
  /** Stop following canyon acoustics and strip the chain back to dry. */
  unroute(source: RoutableAudio): void;
  /** Apply/clear the filter chain on a playing source (see below). */
  applyCanyonFilters(source: RoutableAudio, stem: AcousticStem): void;
  /** Canyon acoustic state for AudioManager.getAudioState. */
  state(): { reverbActive: boolean; wallTightness: number; wallWetness: number; routedLayers: number };
  /** Forget every route and cached IR (manager dispose). */
  clear(): void;
}

export function createAcousticRouter(context: AudioContext | null): AcousticRouter {
  // Canyon acoustic state
  const canyonAcoustics = {
    active: false,
    wallTightness: 0,
    wallWetness: DEFAULT_WALL_WETNESS,
  };
  /** Layers that follow canyon acoustics, re-routed whenever the walls change. */
  const routedSources = new Map<RoutableAudio, AcousticStem>();
  /** Send-bus nodes hung off each routed layer's chain, released on re-route. */
  const sendNodes = new WeakMap<RoutableAudio, AudioNode[]>();
  /** Synthetic impulse responses, cached per 50 ms of decay. */
  const impulseCache = new Map<number, AudioBuffer>();

  /**
   * Build a lightweight synthetic IR for canyon-like reverberation. Cached per
   * 50 ms of decay so re-routing a layer does not regenerate noise.
   */
  function syntheticImpulseResponse(decaySeconds: number): AudioBuffer | null {
    if (!context) return null;
    const key = Math.round(decaySeconds * 20);
    const cached = impulseCache.get(key);
    if (cached) return cached;

    const sampleRate = context.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * (key / 20)));
    const buffer = context.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const t = i / length;
        const envelope = Math.pow(1 - t, 2.2);
        data[i] = (random() * 2 - 1) * envelope;
      }
    }

    impulseCache.set(key, buffer);
    return buffer;
  }

  function refreshAcousticRouting(): void {
    for (const [source, stem] of routedSources) {
      try {
        applyCanyonFilters(source, stem);
      } catch (error) {
        console.warn('[AudioManager] Dropping acoustic route for a dead source:', error);
        routedSources.delete(source);
      }
    }
  }

  function releaseSendNodes(source: RoutableAudio): void {
    const nodes = sendNodes.get(source);
    if (!nodes) return;
    for (const node of nodes) node.disconnect();
    sendNodes.delete(source);
  }

  /**
   * Apply/clear the acoustic filter chain on a playing source.
   *
   * Two independent contributions, composed in one chain so a source is never
   * handed two competing `setFilters` calls: canyon acoustics (wall tightness
   * and surface) and the survival wetness muffle. Either can be absent.
   *
   * Canyon acoustics are sends around a unity dry path (canyonAcoustics.ts):
   *
   *   in ─ lowpass ─────────────────────────────── out ─ [wetness muffle]
   *    ├─ convolver ─ reverbSend ────────────────┘
   *    └─ ER lowpass ─ delay/tap ×N ─ erSend ────┘   (rapids stem only)
   *
   * `setFilters` wires the `in → lowpass → out` spine; the sends hang off it
   * and are tracked so a re-route can release them.
   */
  function applyCanyonFilters(source: RoutableAudio, stem: AcousticStem): void {
    releaseSendNodes(source);
    const ctx = context;
    if (!ctx) {
      source.setFilters([]);
      return;
    }

    const filters: AudioNode[] = [];
    const sends: AudioNode[] = [];

    if (canyonAcoustics.active) {
      const p = canyonAcousticParams(canyonAcoustics.wallTightness, canyonAcoustics.wallWetness);

      const input = ctx.createGain();
      const lowPass = ctx.createBiquadFilter();
      lowPass.type = 'lowpass';
      lowPass.frequency.value = p.lowpassHz;
      lowPass.Q.value = p.lowpassQ;
      const output = ctx.createGain();
      filters.push(input, lowPass, output);

      const convolver = ctx.createConvolver();
      convolver.buffer = syntheticImpulseResponse(p.reverbDecaySeconds);
      const reverbReturn = ctx.createGain();
      reverbReturn.gain.value = p.reverbSend;
      input.connect(convolver);
      convolver.connect(reverbReturn);
      reverbReturn.connect(output);
      sends.push(convolver, reverbReturn);

      if (stem === 'rapids' && p.taps.length > 0) {
        const erFilter = ctx.createBiquadFilter();
        erFilter.type = 'lowpass';
        erFilter.frequency.value = p.earlyReflectionLowpassHz;
        const erReturn = ctx.createGain();
        erReturn.gain.value = p.earlyReflectionSend;
        input.connect(erFilter);
        for (const tap of p.taps) {
          const delay = ctx.createDelay(0.5);
          delay.delayTime.value = tap.delaySeconds;
          const tapGain = ctx.createGain();
          tapGain.gain.value = tap.gain;
          erFilter.connect(delay);
          delay.connect(tapGain);
          tapGain.connect(erReturn);
          sends.push(delay, tapGain);
        }
        erReturn.connect(output);
        sends.push(erFilter, erReturn);
      }
    }

    const wetnessCutoff = wetnessCutoffHz();
    if (wetnessCutoff !== null) {
      const muffle = ctx.createBiquadFilter();
      muffle.type = 'lowpass';
      muffle.frequency.value = wetnessCutoff;
      muffle.Q.value = 0.4;
      filters.push(muffle);
    }

    source.setFilters(filters);
    if (sends.length > 0) sendNodes.set(source, sends);
  }

  return {
    enable(wallTightness, wallWetness) {
      const tightness = Number.isFinite(wallTightness) ? Math.max(0, Math.min(1, wallTightness)) : 0;
      const wetness = Number.isFinite(wallWetness) ? Math.max(0, Math.min(1, wallWetness)) : DEFAULT_WALL_WETNESS;
      const state = canyonAcoustics;
      if (
        state.active &&
        Math.abs(state.wallTightness - tightness) < 1e-3 &&
        Math.abs(state.wallWetness - wetness) < 1e-3
      ) {
        return;
      }
      state.active = true;
      state.wallTightness = tightness;
      state.wallWetness = wetness;
      refreshAcousticRouting();
    },

    disable() {
      const wasActive = canyonAcoustics.active;
      canyonAcoustics.active = false;
      canyonAcoustics.wallTightness = 0;
      if (wasActive) refreshAcousticRouting();
    },

    wallTightness: () => (canyonAcoustics.active ? canyonAcoustics.wallTightness : 0),

    route(source, stem) {
      routedSources.set(source, stem);
      applyCanyonFilters(source, stem);
    },

    unroute(source) {
      if (!routedSources.delete(source)) return;
      releaseSendNodes(source);
      try {
        source.setFilters([]);
      } catch {
        // Source already torn down — nothing left to strip.
      }
    },

    applyCanyonFilters,

    state: () => ({
      reverbActive: canyonAcoustics.active,
      wallTightness: canyonAcoustics.wallTightness,
      wallWetness: canyonAcoustics.wallWetness,
      routedLayers: routedSources.size,
    }),

    clear() {
      routedSources.clear();
      impulseCache.clear();
    },
  };
}
