import { afterEach, describe, expect, it } from 'vitest';
import { resolveInitialVehicle } from './useInnerExperience';
import { allowedVehiclesForMap, mapRegistryIds } from '../../maps/registry';
import { getVehicleChoice, setVehicleChoice, setVehicleOverride, subscribeVehicleChoice } from '../../utils/runContext';

afterEach(() => {
  setVehicleChoice('meander', null);
  setVehicleOverride(null);
  window.history.replaceState(null, '', '/');
});

describe('vehicle picker', () => {
  it('the delta forces the raft, the glacial tube the runner, the rest allow both', () => {
    expect(allowedVehiclesForMap('delta')).toEqual(['raft']);
    expect(allowedVehiclesForMap('glacial')).toEqual(['runner']);
    for (const id of mapRegistryIds().filter((m) => m !== 'delta' && m !== 'glacial')) {
      expect(allowedVehiclesForMap(id)).toEqual(['runner', 'raft']);
    }
  });

  it('a pick is scoped to its map', () => {
    setVehicleChoice('meander', 'raft');
    expect(getVehicleChoice('meander')).toBe('raft');
    expect(getVehicleChoice('hydro')).toBeNull();
    expect(resolveInitialVehicle('meander')).toBe('raft');
    // A continuation into another map gets that map's own vehicle.
    expect(resolveInitialVehicle('delta')).toBe('raft');
    expect(resolveInitialVehicle('hydro')).toBe('runner');
  });

  it('"River decides" is the map preference (today\'s behaviour)', () => {
    setVehicleChoice('meander', null);
    expect(resolveInitialVehicle('meander')).toBe('runner');
    expect(resolveInitialVehicle('delta')).toBe('raft');
  });

  it('?vehicle= and the replay pin still win over a pick', () => {
    setVehicleChoice('meander', 'raft');
    window.history.replaceState(null, '', '/?vehicle=runner');
    expect(resolveInitialVehicle('meander')).toBe('runner');
    window.history.replaceState(null, '', '/');
    setVehicleOverride('runner');
    expect(resolveInitialVehicle('meander')).toBe('runner');
  });

  it('tells the mounted world when the pick changes', () => {
    let calls = 0;
    const off = subscribeVehicleChoice(() => {
      calls += 1;
    });
    setVehicleChoice('meander', 'raft');
    setVehicleChoice('meander', null);
    off();
    setVehicleChoice('meander', 'raft');
    expect(calls).toBe(2);
  });
});
