import { describe, expect, it } from 'vitest';
import { judgeGhostFairness, fairnessFromGhostFile, hydroFairnessDiffers } from './hydroFairness';
import { exportGhostToJson, importGhostFromJson } from './ghostExport';
import { ASSIST_GAME_SPEED, ASSIST_NON_LETHAL } from '../settings/access';

const river = { launchHour: 9, hydroEventHash: 'abc123' };

describe('assisted runs are kept out of ghost comparison (#558 D.2)', () => {
  it('an unassisted run races an unassisted ghost as before', () => {
    expect(judgeGhostFairness(river, river, 'rival').kind).toBe('match');
  });

  it('refuses an assisted ghost for an unassisted run, and the reverse', () => {
    const assisted = { ...river, assists: ASSIST_GAME_SPEED };
    const a = judgeGhostFairness(river, assisted, 'rival');
    const b = judgeGhostFairness(assisted, river, 'PB');
    expect(a.kind === 'refused' && a.reason).toBe('assist_mismatch');
    expect(b.kind === 'refused' && b.reason).toBe('assist_mismatch');
  });

  it('two runs with different assists do not race either', () => {
    const v = judgeGhostFairness(
      { ...river, assists: ASSIST_GAME_SPEED },
      { ...river, assists: ASSIST_NON_LETHAL },
      'rival',
    );
    expect(v.kind).toBe('refused');
    expect(hydroFairnessDiffers({ ...river, assists: 1 }, river)).toBe(true);
  });

  it('the .wsghost carries the bits; an import of an assisted file is refused for an unassisted run', () => {
    const json = exportGhostToJson('meander', 1000, 'AAAA', undefined, river, { assists: ASSIST_NON_LETHAL });
    const file = JSON.parse(json);
    expect(file.assists).toBe(ASSIST_NON_LETHAL);
    expect(fairnessFromGhostFile(file).assists).toBe(ASSIST_NON_LETHAL);
    const result = importGhostFromJson(json, 'meander', river);
    expect(result.ok === false && result.reason).toBe('assist_mismatch');
  });

  it('an unassisted export has no assists field (files stay as they were)', () => {
    expect(JSON.parse(exportGhostToJson('meander', 1000, 'AAAA', undefined, river, {})).assists).toBeUndefined();
  });
});
