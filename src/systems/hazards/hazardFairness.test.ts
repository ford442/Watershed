import { describe, expect, it } from 'vitest';
import hydro from '../../maps/hydro_dam.json';
import meander from '../../maps/meander_to_waterfall.json';
import { parseHydroEvents } from '../water/hydroEvents';
import { hashHydroEvents } from '../water/hydroEvents';
import { hazardsFairnessPart } from './hazardFairness';

const hydroEvents = parseHydroEvents(hydro.hydroEvents);

describe('hazardsFairnessPart (#578 A)', () => {
  it('is empty with no hazards, or none live at the hour — the hash is what it was before hazards', () => {
    expect(hazardsFairnessPart(undefined, [], 14)).toBe('');
    expect(hazardsFairnessPart((meander as { hazards?: unknown }).hazards, parseHydroEvents(meander.hydroEvents), 14)).toBe('');
    expect(hazardsFairnessPart(hydro.hazards, hydroEvents, 6)).toBe('');
    expect(hashHydroEvents(hydroEvents, 6, hazardsFairnessPart(hydro.hazards, hydroEvents, 6))).toBe(
      hashHydroEvents(hydroEvents, 6),
    );
  });

  it('keys the 14:00 hydro river apart from one without its release', () => {
    const part = hazardsFairnessPart(hydro.hazards, hydroEvents, 14);
    expect(part).toContain('hydro-dam-release');
    expect(hashHydroEvents(hydroEvents, 14, part)).not.toBe(hashHydroEvents(hydroEvents, 14));
  });

  it('changes when the live hazard is authored differently, and not with authored order', () => {
    const [dam] = hydro.hazards;
    const harder = [{ ...dam, release: { ...dam.release, discharge: 90 } }];
    expect(hazardsFairnessPart(harder, hydroEvents, 14)).not.toBe(hazardsFairnessPart(hydro.hazards, hydroEvents, 14));
    const other = { ...dam, id: 'a-second-release', segmentIndex: 6 };
    expect(hazardsFairnessPart([dam, other], hydroEvents, 14)).toBe(hazardsFairnessPart([other, dam], hydroEvents, 14));
  });
});
