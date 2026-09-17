import { describe, expect, it } from 'vitest';
import hydro from '../../maps/hydro_dam.json';
import { parseHydroEvents, HYDRO_VORTEX_SINK } from './hydroEvents';
import {
  SWE_FOAM_READS,
  SWE_SWIRL_MAX,
  VORTEX_RING_OPACITY,
  liveSweVortex,
  resolveSurfaceSwirl,
  resolveVortexDecoration,
  sweSwirlIntensity,
} from './sweSwirl';

const EVENTS = parseHydroEvents(hydro.hydroEvents);
/** Vortex Chamber — the segment with the authored drain and the SWE vortex. */
const CHAMBER = 5;
/** Drain Throat — authored drain, never an SWE vortex. */
const THROAT = 6;
const DAM_HOUR = 14;
const SCOUT_HOUR = 6;

const AUTHORED = { centerT: 0.55, lateralOffset: 0, radius: 11 };

describe('sweSwirlIntensity', () => {
  it('scales with the η sink the event actually applies', () => {
    expect(sweSwirlIntensity(0)).toBe(0);
    expect(sweSwirlIntensity(Number.NaN)).toBe(0);
    expect(sweSwirlIntensity(4.2)).toBeGreaterThan(sweSwirlIntensity(2.1));
    expect(sweSwirlIntensity(1000)).toBe(SWE_SWIRL_MAX);
    expect(sweSwirlIntensity(1)).toBeCloseTo(HYDRO_VORTEX_SINK * 0.68, 6);
  });
});

describe('resolveSurfaceSwirl', () => {
  it('reads the SWE sink on a release hour instead of the forecast curve', () => {
    const swirl = resolveSurfaceSwirl({
      segmentIndex: CHAMBER,
      hour: DAM_HOUR,
      events: EVENTS,
      authored: AUTHORED,
      // A wildly different forecast number: if it leaks through, the shader is
      // still drawing the second vortex.
      authoredIntensity: 99,
    });

    expect(swirl.source).toBe('swe');
    expect(swirl.intensity).toBeLessThanOrEqual(SWE_SWIRL_MAX);
    expect(swirl.intensity).toBeCloseTo(sweSwirlIntensity(4.2), 6);
    expect(swirl.radius).toBe(11);
    expect(swirl.centerT).toBeCloseTo(0.55, 6);
  });

  it('falls back to the authored drain outside the release window', () => {
    const swirl = resolveSurfaceSwirl({
      segmentIndex: CHAMBER,
      hour: SCOUT_HOUR,
      events: EVENTS,
      authored: AUTHORED,
      authoredIntensity: 0.9,
    });

    expect(swirl.source).toBe('authored');
    expect(swirl.intensity).toBeCloseTo(0.9, 6);
    expect(swirl.radius).toBe(11);
  });

  it('never lets both models describe the same water', () => {
    const hours = Array.from({ length: 24 }, (_, hour) => hour);
    for (const hour of hours) {
      const swirl = resolveSurfaceSwirl({
        segmentIndex: CHAMBER,
        hour,
        events: EVENTS,
        authored: AUTHORED,
        authoredIntensity: 1,
      });
      const live = liveSweVortex(EVENTS, hour, CHAMBER);
      expect(swirl.source).toBe(live ? 'swe' : 'authored');
    }
  });

  it('leaves segments with an authored drain but no SWE vortex alone', () => {
    const swirl = resolveSurfaceSwirl({
      segmentIndex: THROAT,
      hour: DAM_HOUR,
      events: EVENTS,
      authored: { centerT: 0.35, radius: 7 },
      authoredIntensity: 1.2,
    });
    expect(swirl.source).toBe('authored');
    expect(swirl.centerT).toBeCloseTo(0.35, 6);
  });

  it('draws nothing where neither model applies', () => {
    const swirl = resolveSurfaceSwirl({ segmentIndex: 0, hour: DAM_HOUR, events: EVENTS });
    expect(swirl.source).toBe('none');
    expect(swirl.intensity).toBe(0);
    expect(swirl.centerT).toBeNull();
  });

  it('picks the strongest when a segment authors more than one vortex', () => {
    const events = [
      { id: 'weak', kind: 'vortex' as const, segmentIndex: 1, strength: 1, radius: 5 },
      { id: 'strong', kind: 'vortex' as const, segmentIndex: 1, strength: 3, radius: 9 },
    ];
    expect(liveSweVortex(events, 0, 1)?.id).toBe('strong');
  });
});


describe('resolveVortexDecoration', () => {
  it('drops the particle ring where the SWE eye-foam is already drawing the drain', () => {
    const swirl = resolveSurfaceSwirl({
      segmentIndex: CHAMBER,
      hour: DAM_HOUR,
      events: EVENTS,
      authored: AUTHORED,
      authoredIntensity: 0.9,
    });

    expect(swirl.source).toBe('swe');
    expect(swirl.intensity).toBeGreaterThanOrEqual(SWE_FOAM_READS);
    expect(resolveVortexDecoration(swirl)).toEqual({
      visible: false,
      opacity: 0,
      particleCount: 0,
    });
  });

  it('keeps the ring at full opacity for an authored drain with no field behind it', () => {
    const swirl = resolveSurfaceSwirl({
      segmentIndex: THROAT,
      hour: SCOUT_HOUR,
      events: EVENTS,
      authored: AUTHORED,
      authoredIntensity: 0.7,
    });

    expect(swirl.source).toBe('authored');
    const decoration = resolveVortexDecoration(swirl);
    expect(decoration.visible).toBe(true);
    expect(decoration.opacity).toBe(VORTEX_RING_OPACITY);
    expect(decoration.particleCount).toBeGreaterThan(0);
  });

  it('fades the ring out as a weak SWE drain grows into readable foam', () => {
    const faint = resolveVortexDecoration({
      source: 'swe',
      centerT: 0.5,
      lateralOffset: 0,
      radius: 8,
      intensity: SWE_FOAM_READS * 0.25,
    });
    const stronger = resolveVortexDecoration({
      source: 'swe',
      centerT: 0.5,
      lateralOffset: 0,
      radius: 8,
      intensity: SWE_FOAM_READS * 0.75,
    });

    expect(faint.visible).toBe(true);
    expect(stronger.visible).toBe(true);
    expect(stronger.opacity).toBeLessThan(faint.opacity);
    expect(faint.opacity).toBeLessThan(VORTEX_RING_OPACITY);
  });

  it('draws nothing where no model describes the water', () => {
    expect(
      resolveVortexDecoration({
        source: 'none',
        centerT: null,
        lateralOffset: 0,
        radius: 0,
        intensity: 0,
      }).visible,
    ).toBe(false);
  });
});
