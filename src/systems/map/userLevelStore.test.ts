import { describe, expect, it, beforeEach } from 'vitest';
import glacialLevel from '../../maps/glacial_source.json';
import {
  clearUserLevelsForTests,
  listUserLevels,
  loadUserLevel,
  saveUserLevel,
} from './userLevelStore';

describe('userLevelStore', () => {
  beforeEach(() => {
    clearUserLevelsForTests();
  });

  it('round-trips a schema-valid level through localStorage', () => {
    saveUserLevel('glacial-copy', glacialLevel);
    expect(listUserLevels().map((e) => e.id)).toEqual(['glacial-copy']);
    expect(loadUserLevel('glacial-copy')?.level.metadata.name).toBe('Glacial Source');
    expect(loadUserLevel('glacial-copy')?.level.hydroEvents?.some((e) => e.kind === 'roughness')).toBe(
      true,
    );
  });

  it('rejects invalid JSON that fails assertLevelData', () => {
    expect(() => saveUserLevel('bad', { metadata: { name: 'nope' } })).toThrow(/failed level validation/);
  });
});
