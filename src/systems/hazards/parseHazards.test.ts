import { describe, expect, it } from 'vitest';
import { validateLevel } from '../../utils/levelValidator';
import { MAP_REGISTRY } from '../../maps/registry';
import { parseHazards } from './parseHazards';
import {
  HAZARD_DEFAULT_ACTIVE_SECONDS,
  HAZARD_DEFAULT_ARM_DISTANCE,
  HAZARD_DEFAULT_RADIUS,
  HAZARD_DEFAULT_TELEGRAPH_SECONDS,
  HAZARD_MIN_TELEGRAPH_SECONDS,
} from './hazardTypes';

const JAM = {
  id: 'lumber-jam',
  kind: 'logJam',
  segmentIndex: 9,
  hydroEventId: 'dam-pulse',
  trigger: { type: 'stage', above: 0.6, distance: 60 },
  telegraphSeconds: 2.5,
  activeSeconds: 8,
  consequence: { wetness: 0.4, chill: 0.1 },
};

describe('parseHazards (#522 A)', () => {
  it('fills the defaults the lifecycle reads', () => {
    expect(parseHazards([{ id: 'a', kind: 'iceBridge', segmentIndex: 3, trigger: { type: 'proximity', distance: 12 } }])).toEqual([
      {
        id: 'a',
        kind: 'iceBridge',
        segmentIndex: 3,
        centerT: 0.5,
        lateralOffset: 0,
        radius: HAZARD_DEFAULT_RADIUS,
        armDistance: HAZARD_DEFAULT_ARM_DISTANCE,
        trigger: { type: 'proximity', distance: 12 },
        telegraphSeconds: HAZARD_DEFAULT_TELEGRAPH_SECONDS,
        activeSeconds: HAZARD_DEFAULT_ACTIVE_SECONDS,
      },
    ]);
  });

  it('keeps an authored hazard as written', () => {
    const [jam] = parseHazards([JAM]);
    expect(jam).toMatchObject({
      id: 'lumber-jam',
      hydroEventId: 'dam-pulse',
      trigger: { type: 'stage', above: 0.6, distance: 60 },
      telegraphSeconds: 2.5,
      activeSeconds: 8,
      consequence: { wetness: 0.4, chill: 0.1 },
    });
  });

  it('drops what it cannot run, and a repeated id', () => {
    const parsed = parseHazards([
      JAM,
      { ...JAM }, // duplicate id
      { ...JAM, id: 'k', kind: 'kraken' },
      { ...JAM, id: 'n', segmentIndex: -1 },
      { ...JAM, id: 'f', segmentIndex: 1.5 },
      { ...JAM, id: 't', trigger: { type: 'whenever' } },
      { ...JAM, id: 'p', trigger: { type: 'proximity', distance: 0 } },
      { ...JAM, id: 'd', trigger: { type: 'delay', seconds: -1 } },
      null,
      'jam',
    ]);
    expect(parsed.map((h) => h.id)).toEqual(['lumber-jam']);
    expect(parseHazards(undefined)).toEqual([]);
    expect(parseHazards({})).toEqual([]);
  });

  it('clamps a too-short telegraph up to the minimum and the consequence into 0–1', () => {
    const [h] = parseHazards([{ ...JAM, telegraphSeconds: 0.5, consequence: { wetness: 3, chill: -1 } }]);
    expect(h.telegraphSeconds).toBe(HAZARD_MIN_TELEGRAPH_SECONDS);
    expect(h.consequence).toEqual({ wetness: 1, chill: 0 });
  });
});

describe('level schema: hazards[] (#522 A)', () => {
  const base = MAP_REGISTRY.lumber.levelData;
  const errorsFor = (hazards: unknown[]) =>
    validateLevel({ ...base, hazards }).errors.filter((e) => e.field.startsWith('hazards'));

  it('accepts each trigger type', () => {
    expect(
      errorsFor([
        JAM,
        { id: 'b', kind: 'iceBridge', segmentIndex: 2, trigger: { type: 'proximity', distance: 10 } },
        { id: 'c', kind: 'damRelease', segmentIndex: 4, trigger: { type: 'delay', seconds: 3 }, hours: [14] },
      ]),
    ).toEqual([]);
  });

  it('rejects a telegraph under 1.5 s, an unknown kind, field or trigger type, and no trigger', () => {
    expect(errorsFor([{ ...JAM, telegraphSeconds: 1 }]).length).toBeGreaterThan(0);
    expect(errorsFor([{ ...JAM, kind: 'kraken' }]).length).toBeGreaterThan(0);
    expect(errorsFor([{ ...JAM, colour: 'red' }]).length).toBeGreaterThan(0);
    expect(errorsFor([{ ...JAM, trigger: { type: 'whenever' } }]).length).toBeGreaterThan(0);
    expect(errorsFor([{ ...JAM, trigger: { type: 'delay', seconds: 1, colour: 'red' } }]).length).toBeGreaterThan(0);
    expect(errorsFor([{ ...JAM, trigger: undefined }]).length).toBeGreaterThan(0);
  });

  it('leaves a trigger missing its number to the parser (one flat trigger object keeps the validator small)', () => {
    const missing = { ...JAM, trigger: { type: 'proximity' } };
    expect(errorsFor([missing])).toEqual([]);
    expect(parseHazards([missing])).toEqual([]); // so registry.contract.test.ts fails a map that ships one
  });
});
