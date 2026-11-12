/**
 * createHeadlessRun.campaign.test.ts — what a headless run is built of (#556 B.1).
 *
 * Structure only; the run's numbers are pinned to the browser's in headless.campaign.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PLAYER_SPAWN } from '../../constants/game';
import { getRegisteredBathymetryCount } from '../../systems/water/bathymetrySampler';
import { simCore } from '../core/SimCore';
import { createHeadlessRun, type HeadlessRun } from './createHeadlessRun';

let live: HeadlessRun | null = null;
afterEach(() => {
  live?.dispose();
  live = null;
});

describe('createHeadlessRun', () => {
  it('registers the page\'s systems, the world step and the runner, in the page\'s order', async () => {
    live = await createHeadlessRun({ mapId: 'meander' });
    expect(simCore.getSystemIds()).toEqual([
      'weather-director',
      'sky-clock',
      'chunk-biome',
      'gameplay-profile',
      'survival',
      'hazards',
      'pillars',
      'score',
      'physics-world',
      'vehicle-runner',
    ]);
  });

  it('builds the treadmill\'s seven live segments as colliders and SWE beds, the runner at its spawn', async () => {
    live = await createHeadlessRun({ mapId: 'meander' });
    // The meander starts at segment -3 (a glacial lead-in); the pool holds MAX_ACTIVE_SEGMENTS = 7.
    expect(live.segmentWorld.ids()).toEqual([-3, -2, -1, 0, 1, 2, 3]);
    // Seven hulls, the runner's capsule, and the pool floor box under each of segments 0..3: the launch hour's
    // forecast floods them (`typeOverride: 'pond'`), and a pond mounts its safety floor.
    expect(live.world.colliders.len()).toBe(7 + 1 + 4);
    const p = live.body.translation();
    expect([p.x, p.y, p.z]).toEqual([...PLAYER_SPAWN.position]);
    // The page leaves segment 0 without a bed (pageQuirks.spareSlotsDropBedZero): six of seven are registered.
    expect(getRegisteredBathymetryCount()).toBe(6);
  });

  it('registers all seven beds when the page quirk is off', async () => {
    live = await createHeadlessRun({ mapId: 'meander', pageQuirks: { spareSlotsDropBedZero: false } });
    expect(getRegisteredBathymetryCount()).toBe(7);
  });

  it('runs the shipped WASM field at the preset\'s budget, and none at low', async () => {
    live = await createHeadlessRun({ mapId: 'meander', quality: 'medium' });
    expect(live.water.grid).not.toBeNull();
    expect(live.water.budget.enabled).toBe(true);
    live.dispose();
    live = await createHeadlessRun({ mapId: 'meander', quality: 'low' });
    expect(live.water.grid).toBeNull();
  });

  it('releases the process state on dispose', async () => {
    const run = await createHeadlessRun({ mapId: 'meander' });
    run.dispose();
    expect(simCore.getSystemIds()).toEqual([]);
    expect(getRegisteredBathymetryCount()).toBe(0);
  });
});
