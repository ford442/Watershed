import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import glacialLevel from '../../maps/glacial_source.json';
import lumberLevel from '../../maps/lumber_flume.json';
import { clearUserLevelsForTests, saveUserLevel } from './userLevelStore';
import { listSavedRivers, loadSavedRiver, parseRiverText, riverIdFromName } from './userRiverImport';
import {
  createUserRiver,
  getActiveUserRiver,
  hashUserRiverLevel,
  setActiveUserRiver,
  subscribeUserRiver,
} from './userRiverSession';
import { getRunMap } from '../journey/runSession';
import { getActiveRunKey } from '../../utils/runContext';
import { currentRunFairness, hydroEventsForMap } from '../ghost/raceFairness';
import type { LevelData } from './MapSystem';

const lumberText = JSON.stringify(lumberLevel);

beforeEach(() => clearUserLevelsForTests());
afterEach(() => setActiveUserRiver(null));

describe('.wsriver import', () => {
  it('accepts the JSON the editor exports and names it from the file', () => {
    const river = parseRiverText(lumberText, 'My Flume.wsriver');
    expect(river.id).toBe('my-flume');
    expect(river.label).toBe(lumberLevel.metadata.name);
    expect(river.level.segments.length).toBe(lumberLevel.segments.length);
  });

  it('refuses what is not a river, with a message fit for the menu', () => {
    expect(() => parseRiverText('{nope', 'x.wsriver')).toThrow(/not JSON/);
    expect(() => parseRiverText(JSON.stringify({ metadata: { name: 'nope' } }), 'x.wsriver')).toThrow(
      /failed level validation/,
    );
  });

  it('slugs file names', () => {
    expect(riverIdFromName('Devil’s Gorge (v2).json')).toBe('devil-s-gorge-v2');
    expect(riverIdFromName('.wsriver')).toBe('river');
  });

  it('lists saved rivers newest first and loads one by id, validated', () => {
    saveUserLevel('glacial-copy', glacialLevel);
    saveUserLevel('lumber-copy', lumberLevel);
    expect(listSavedRivers().map((r) => r.id)).toEqual(['lumber-copy', 'glacial-copy']);
    expect(loadSavedRiver('glacial-copy')?.level.metadata.name).toBe('Glacial Source');
    expect(loadSavedRiver('missing')).toBeNull();
  });
});

describe('the river is the run map for the session', () => {
  it('hashes content: an edit is a different river', () => {
    const a = parseRiverText(lumberText, 'a.wsriver');
    const edited = JSON.parse(lumberText) as LevelData;
    edited.segments[0] = { ...edited.segments[0], width: (edited.segments[0].width ?? 20) + 1 };
    expect(hashUserRiverLevel(a.level)).toBe(parseRiverText(lumberText, 'b.wsriver').hash);
    expect(createUserRiver('a', edited).hash).not.toBe(a.hash);
  });

  it('getRunMap resolves to the river: its segments and hydroEvents drive the run', () => {
    const before = getRunMap();
    const river = parseRiverText(lumberText, 'flume.wsriver');
    setActiveUserRiver(river);
    const runMap = getRunMap();
    expect(runMap.levelData).toBe(river.level);
    expect(runMap.startIndex).toBe(0);
    expect(runMap.initialBiome).toBe('lumberFlume');
    expect(runMap.continuation).toBeUndefined();
    expect(hydroEventsForMap('glacial').length).toBe((lumberLevel.hydroEvents ?? []).length);
    setActiveUserRiver(null);
    expect(getRunMap().levelData).toBe(before.levelData);
  });

  it('keys bests and ghost fairness by the river hash', () => {
    const campaignKey = getActiveRunKey('glacial');
    const campaignFairness = currentRunFairness('glacial');
    const river = parseRiverText(JSON.stringify(glacialLevel), 'glacial-copy.wsriver');
    setActiveUserRiver(river);
    expect(getActiveRunKey('glacial')).toMatch(new RegExp(`^river-${river.hash}:`));
    // Same events as the campaign map, still a different river for a ghost.
    expect(currentRunFairness('glacial').hydroEventHash).not.toBe(campaignFairness.hydroEventHash);
    setActiveUserRiver(null);
    expect(getActiveRunKey('glacial')).toBe(campaignKey);
  });

  it('notifies subscribers on change only', () => {
    let calls = 0;
    const off = subscribeUserRiver(() => {
      calls += 1;
    });
    const river = parseRiverText(lumberText, 'flume.wsriver');
    setActiveUserRiver(river);
    setActiveUserRiver(river);
    expect(getActiveUserRiver()).toBe(river);
    setActiveUserRiver(null);
    off();
    expect(calls).toBe(2);
  });
});
