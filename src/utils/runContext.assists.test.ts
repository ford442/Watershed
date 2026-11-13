import { afterEach, describe, expect, it } from 'vitest';
import { getActiveRunKey } from './runContext';
import { beginRunAssists, resetAccessRuntimeForTests, setLiveAssists } from '../systems/settings/accessRuntime';
import { NO_ASSISTS } from '../systems/settings/access';

describe('assisted run keys (#558 D.2)', () => {
  afterEach(() => resetAccessRuntimeForTests());

  it('an unassisted run keeps the key it always had', () => {
    expect(getActiveRunKey('meander')).toMatch(/^meander:\d+$/);
  });

  it('an assisted run keys apart, after the map id, so `meander:` scans skip it', () => {
    setLiveAssists({ ...NO_ASSISTS, gameSpeed: 0.8 });
    beginRunAssists();
    const key = getActiveRunKey('meander');
    expect(key).toMatch(/^meander~a1:\d+$/);
    expect(key.startsWith('meander:')).toBe(false);
  });
});
