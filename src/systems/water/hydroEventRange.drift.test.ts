/**
 * One range for an authored hydro event (#575): level.schema.json (what the
 * validator, and so a `#river=` share link, accepts), parseHydroEvents, and the
 * native applySWEEvent maxima (abi.def SWE_EVENT_MAX_*, generated into both
 * abi_generated.h and wasmAbi.generated.ts). A shared river that passes the
 * validator is never refused by the solver, and one the solver would refuse
 * fails at load.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateLevel } from '../../utils/levelValidator';
import { HYDRO_EVENT_RADIUS_RANGE, HYDRO_EVENT_STRENGTH_RANGE, parseHydroEvents } from './hydroEvents';
import { SWE_EVENT_MAX_RADIUS, SWE_EVENT_MAX_STRENGTH } from './wasmAbi';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(resolve(here, '../../formats/level.schema.json'), 'utf8')) as {
  properties: { hydroEvents: { items: { properties: Record<string, { minimum: number; maximum: number }> } } };
};
const props = schema.properties.hydroEvents.items.properties;

describe('hydro event range: schema = parseHydroEvents = native maxima', () => {
  it('radius', () => {
    expect(props.radius.maximum).toBe(SWE_EVENT_MAX_RADIUS);
    expect(HYDRO_EVENT_RADIUS_RANGE).toEqual({ min: props.radius.minimum, max: props.radius.maximum });
  });

  it('strength', () => {
    expect(props.strength.maximum).toBe(SWE_EVENT_MAX_STRENGTH);
    expect(HYDRO_EVENT_STRENGTH_RANGE).toEqual({ min: props.strength.minimum, max: props.strength.maximum });
  });

  it('parseHydroEvents drops an event the solver would refuse, keeps one at the limits', () => {
    const base = { kind: 'inflowPulse', segmentIndex: 1 };
    const parsed = parseHydroEvents([
      { ...base, id: 'edge', radius: SWE_EVENT_MAX_RADIUS, strength: SWE_EVENT_MAX_STRENGTH },
      { ...base, id: 'huge-radius', radius: 3e38 },
      { ...base, id: 'huge-strength', strength: 3e38 },
      { ...base, id: 'tiny-radius', radius: 0.1 },
      { ...base, id: 'negative-strength', strength: -1 },
      { ...base, id: 'string-radius', radius: '9' },
    ]);
    expect(parsed.map((e) => e.id)).toEqual(['edge']);
  });

  it('the validator refuses a level carrying an out-of-range event (a shared river fails at load)', () => {
    // The minimal valid level of levelValidator.test.ts.
    const level = {
      metadata: { name: 'Shared', author: 'A', difficulty: 'beginner', estimatedDuration: 120, version: '1.0.0' },
      world: {
        track: { waypoints: [[0, 0, 0], [0, -5, -30], [10, -10, -80], [-5, -15, -140]], segmentLength: 30, totalSegments: 3 },
        biome: {
          baseType: 'creek-summer',
          sky: { color: '#87CEEB' },
          fog: { color: '#D4E9F7', near: 50, far: 200 },
          lighting: { sunIntensity: 1.4, sunAngle: 45 },
          water: { tint: '#1a6b8a', flowSpeed: 1.0 },
        },
      },
      segments: [
        { index: 0, difficulty: 0.3, decorations: { trees: 10 } },
        { index: 1, difficulty: 0.4, decorations: { trees: 12 } },
        { index: 2, difficulty: 0.5, decorations: { trees: 8 } },
      ],
      spawns: { start: { position: [0, -4, 5] } },
    };
    const ok = validateLevel({ ...level, hydroEvents: [{ id: 'p', kind: 'surge', segmentIndex: 1, radius: 9, strength: 1 }] });
    expect(ok.valid, JSON.stringify(ok.errors)).toBe(true);
    const bad = validateLevel({ ...level, hydroEvents: [{ id: 'p', kind: 'surge', segmentIndex: 1, radius: 3e38, strength: 1 }] });
    expect(bad.valid).toBe(false);
  });
});
