import { describe, expect, it } from 'vitest';
import hydro from '../../maps/hydro_dam.json';
import { parseHydroEvents } from './hydroEvents';
import { buildHydroHudBoard, HYDRO_CONTROL_HOUR, HYDRO_RELEASE_HOUR } from './hydroHud';

const EVENTS = parseHydroEvents(hydro.hydroEvents);

describe('hydroHud', () => {
  it('lists the dam pulse and vortex as live at the release hour', () => {
    const board = buildHydroHudBoard(EVENTS, HYDRO_RELEASE_HOUR, 4);
    expect(board.rows.map((r) => r.id)).toEqual(['hydro-dam-pulse', 'hydro-vortex-chamber']);
    expect(board.rows[0].here).toBe(true);
    expect(board.contrastHour).toBe(HYDRO_CONTROL_HOUR);
    expect(board.gained.every((g) => g.id.startsWith('hydro-dawn'))).toBe(true);
  });

  it('lists the dawn drawdown at the control hour and names what 14:00 would add', () => {
    const board = buildHydroHudBoard(EVENTS, HYDRO_CONTROL_HOUR);
    expect(board.rows.map((r) => r.id)).toEqual([
      'hydro-dawn-drawdown',
      'hydro-dawn-gravelbar',
      'hydro-dawn-eddy',
    ]);
    expect(board.rows.every((r) => !r.here)).toBe(true);
    expect(board.gained).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'inflowPulse', segmentIndex: 4 }),
        expect.objectContaining({ kind: 'vortex', segmentIndex: 5 }),
      ]),
    );
  });

  it('an hour with nothing authored still reports the release-hour contrast', () => {
    const board = buildHydroHudBoard(EVENTS, 21);
    expect(board.rows).toEqual([]);
    expect(board.contrastHour).toBe(HYDRO_RELEASE_HOUR);
    expect(board.gained.length).toBeGreaterThan(0);
  });
});
