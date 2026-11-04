import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gameEvents } from '../events/GameEvents';
import {
  resetGhostRecording,
  startGhostRecording,
  stopGhostRecording,
  tickGhostRecording,
} from '../ghost/GhostRecorder';
import { exportGhostToJson, importGhostFromJson } from '../ghost/ghostExport';
import { getRecordedHazardLog, initHazardLogListener, resetHazardLog } from './hazardLog';

const POSE = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

function phase(hazardId: string, p: 'dormant' | 'armed' | 'telegraph' | 'active' | 'spent'): void {
  gameEvents.emit('hazard-phase', { hazardId, kind: 'logJam', segmentIndex: 4, phase: p, anchor: null });
}

describe('hazard log (#522 A)', () => {
  beforeEach(() => {
    initHazardLogListener();
    resetHazardLog();
    resetGhostRecording();
  });

  afterEach(() => {
    stopGhostRecording();
    resetGhostRecording();
    resetHazardLog();
  });

  it('logs phases and hits on the ghost clock while recording, never dormant', () => {
    startGhostRecording();
    for (let i = 0; i < 10; i += 1) tickGhostRecording(0.1, POSE);
    phase('jam', 'armed');
    phase('jam', 'dormant');
    for (let i = 0; i < 5; i += 1) tickGhostRecording(0.1, POSE);
    phase('jam', 'telegraph');
    gameEvents.emit('hazard-hit', { hazardId: 'jam', kind: 'logJam', segmentIndex: 4, wetness: 0.4, chill: 0 });
    expect(getRecordedHazardLog()).toEqual([
      { hazardId: 'jam', event: 'armed', tMs: 1000 },
      { hazardId: 'jam', event: 'telegraph', tMs: 1500 },
      { hazardId: 'jam', event: 'hit', tMs: 1500 },
    ]);
  });

  it('records nothing while the ghost is not recording, and a run reset clears it', () => {
    phase('jam', 'armed');
    expect(getRecordedHazardLog()).toEqual([]);
    startGhostRecording();
    phase('jam', 'armed');
    expect(getRecordedHazardLog()).toHaveLength(1);
    gameEvents.emit('watershed-run-reset', {});
    expect(getRecordedHazardLog()).toEqual([]);
  });

  it('rides in a v5 .wsghost and survives the import check', () => {
    startGhostRecording();
    phase('jam', 'armed');
    phase('jam', 'telegraph');
    const json = exportGhostToJson('lumber', 61_000, 'AAAA', undefined, undefined, { hazards: getRecordedHazardLog() });
    const result = importGhostFromJson(json, 'lumber');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.codecVersion).toBe(5);
    expect(result.file.hazards).toEqual([
      { hazardId: 'jam', event: 'armed', tMs: 0 },
      { hazardId: 'jam', event: 'telegraph', tMs: 0 },
    ]);
  });

  it('leaves an empty log out of the file, and refuses a malformed one', () => {
    const empty = JSON.parse(exportGhostToJson('lumber', 61_000, 'AAAA', undefined, undefined, { hazards: [] }));
    expect('hazards' in empty).toBe(false);
    const bad = { ...empty, hazards: [{ hazardId: 'jam', event: 'dormant', tMs: 0 }] };
    expect(importGhostFromJson(JSON.stringify(bad))).toEqual({ ok: false, reason: 'invalid_format' });
    const negative = { ...empty, hazards: [{ hazardId: 'jam', event: 'hit', tMs: -5 }] };
    expect(importGhostFromJson(JSON.stringify(negative))).toEqual({ ok: false, reason: 'invalid_format' });
  });

  it('still imports a v4 file (no hazards)', () => {
    const v4 = { ...JSON.parse(exportGhostToJson('lumber', 61_000, 'AAAA')), codecVersion: 4 };
    expect(importGhostFromJson(JSON.stringify(v4)).ok).toBe(true);
  });
});
