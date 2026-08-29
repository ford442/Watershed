/**
 * ghostPB.test.ts — Tests for:
 *   - PB ghost replace-only-if-faster rule
 *   - Ghost codec size budget (GHOST_MAX_SAMPLES)
 *   - Export/import round-trip
 *   - mapId mismatch rejection
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildRunKey,
  getRunBest,
  resetPersistenceForTests,
  updatePBGhost,
} from '../persistence/PersistenceSystem';
import {
  encodeGhostSamples,
  encodeGhostToBase64,
  GHOST_CODEC_VERSION,
  GHOST_FLOATS_PER_SAMPLE,
  type GhostSample,
  type RunSplitEntry,
} from './ghostCodec';
import { GHOST_MAX_SAMPLES } from './GhostRecorder';
import {
  exportGhostToJson,
  importGhostFromJson,
} from './ghostExport';

const SAMPLE: GhostSample = { px: 1, py: 2, pz: -3, qx: 0, qy: 0, qz: 0, qw: 1 };

function makeGhostPayload(sampleCount = 3): string {
  const samples: GhostSample[] = Array.from({ length: sampleCount }, () => ({ ...SAMPLE }));
  return encodeGhostToBase64(encodeGhostSamples(samples));
}

describe('updatePBGhost — replace only if faster', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPersistenceForTests();
  });

  it('stores ghost on first finish (no prior PB)', () => {
    const key = buildRunKey('meander', 1);
    const updated = updatePBGhost(key, 90_000, makeGhostPayload());
    expect(updated).toBe(true);
    expect(getRunBest(key).bestTimeMs).toBe(90_000);
    expect(getRunBest(key).ghostData).toBeTruthy();
  });

  it('replaces ghost when new time is faster', () => {
    const key = buildRunKey('meander', 2);
    updatePBGhost(key, 90_000, makeGhostPayload());
    const fasterPayload = makeGhostPayload(2);
    const updated = updatePBGhost(key, 80_000, fasterPayload);
    expect(updated).toBe(true);
    expect(getRunBest(key).bestTimeMs).toBe(80_000);
    expect(getRunBest(key).ghostData).toBe(fasterPayload);
  });

  it('keeps existing ghost when new time is slower', () => {
    const key = buildRunKey('meander', 3);
    const originalPayload = makeGhostPayload();
    updatePBGhost(key, 80_000, originalPayload);
    const updated = updatePBGhost(key, 95_000, makeGhostPayload(5));
    expect(updated).toBe(false);
    expect(getRunBest(key).bestTimeMs).toBe(80_000);
    expect(getRunBest(key).ghostData).toBe(originalPayload);
  });

  it('keeps existing ghost when new time exactly equals PB', () => {
    const key = buildRunKey('meander', 4);
    const originalPayload = makeGhostPayload();
    updatePBGhost(key, 80_000, originalPayload);
    const updated = updatePBGhost(key, 80_000, makeGhostPayload(5));
    expect(updated).toBe(false);
    expect(getRunBest(key).ghostData).toBe(originalPayload);
  });

  describe('splits', () => {
    const splitsA: RunSplitEntry[] = [
      { segmentIndex: 0, tMs: 0, speed: 3 },
      { segmentIndex: 5, tMs: 30_000, speed: 12 },
    ];
    const splitsB: RunSplitEntry[] = [
      { segmentIndex: 0, tMs: 0, speed: 4 },
      { segmentIndex: 5, tMs: 25_000, speed: 14 },
    ];

    it('stores splits alongside the ghost on first finish', () => {
      const key = buildRunKey('meander', 10);
      updatePBGhost(key, 90_000, makeGhostPayload(), splitsA);
      expect(getRunBest(key).splits).toEqual(splitsA);
    });

    it('replaces splits when a faster run beats the PB', () => {
      const key = buildRunKey('meander', 11);
      updatePBGhost(key, 90_000, makeGhostPayload(), splitsA);
      updatePBGhost(key, 80_000, makeGhostPayload(2), splitsB);
      expect(getRunBest(key).splits).toEqual(splitsB);
    });

    it('keeps existing splits when a slower run does not beat the PB', () => {
      const key = buildRunKey('meander', 12);
      updatePBGhost(key, 80_000, makeGhostPayload(), splitsA);
      updatePBGhost(key, 95_000, makeGhostPayload(5), splitsB);
      expect(getRunBest(key).splits).toEqual(splitsA);
    });

    it('omitting splits on a beating run leaves the previously stored splits untouched', () => {
      const key = buildRunKey('meander', 13);
      updatePBGhost(key, 90_000, makeGhostPayload(), splitsA);
      updatePBGhost(key, 80_000, makeGhostPayload(2));
      expect(getRunBest(key).splits).toEqual(splitsA);
    });
  });
});

describe('ghost codec size budget', () => {
  it('GHOST_MAX_SAMPLES fits in the 5-minute budget at 10 Hz', () => {
    // 5 minutes × 10 Hz = 3000 samples
    expect(GHOST_MAX_SAMPLES).toBe(3000);
  });

  it('max payload is within a reasonable localStorage budget (< 350 KB)', () => {
    // 3000 samples × 7 floats × 4 bytes → base64 overhead ~4/3 → ~112 KB
    const maxBytes = GHOST_MAX_SAMPLES * GHOST_FLOATS_PER_SAMPLE * 4;
    const maxBase64 = Math.ceil(maxBytes * (4 / 3));
    expect(maxBase64).toBeLessThan(350_000);
  });
});

describe('ghostExport / importGhostFromJson', () => {
  const GHOST = makeGhostPayload();

  it('round-trips export → import successfully', () => {
    const json = exportGhostToJson('meander', 75_000, GHOST);
    const result = importGhostFromJson(json, 'meander');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.mapId).toBe('meander');
    expect(result.file.timeMs).toBe(75_000);
    expect(result.file.ghostData).toBe(GHOST);
    expect(result.file.codecVersion).toBe(GHOST_CODEC_VERSION);
  });

  it('rejects malformed JSON', () => {
    const result = importGhostFromJson('not-json', 'meander');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_json');
  });

  it('rejects missing required fields', () => {
    const result = importGhostFromJson('{"codecVersion":1}', 'meander');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_format');
  });

  it('rejects a codec version newer than this build supports', () => {
    const json = JSON.stringify({
      codecVersion: GHOST_CODEC_VERSION + 1,
      mapId: 'meander',
      timeMs: 60_000,
      ghostData: GHOST,
      exportedAt: Date.now(),
    });
    const result = importGhostFromJson(json, 'meander');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('version_mismatch');
  });

  it('accepts a v1 pose-only file (no splits) as a valid v2 file', () => {
    const json = JSON.stringify({
      codecVersion: 1,
      mapId: 'meander',
      timeMs: 60_000,
      ghostData: GHOST,
      exportedAt: Date.now(),
    });
    const result = importGhostFromJson(json, 'meander');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.splits).toBeUndefined();
  });

  it('round-trips splits through export → import', () => {
    const splits = [{ segmentIndex: 0, tMs: 0, speed: 3 }, { segmentIndex: 5, tMs: 12_000, speed: 9 }];
    const json = exportGhostToJson('meander', 75_000, GHOST, splits);
    const result = importGhostFromJson(json, 'meander');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.splits).toEqual(splits);
    expect(result.file.codecVersion).toBe(GHOST_CODEC_VERSION);
  });

  it('omits splits entirely from the file when none are given', () => {
    const json = exportGhostToJson('meander', 75_000, GHOST);
    expect(JSON.parse(json)).not.toHaveProperty('splits');
  });

  it('rejects a file whose splits array holds malformed entries', () => {
    const json = JSON.stringify({
      codecVersion: GHOST_CODEC_VERSION,
      mapId: 'meander',
      timeMs: 60_000,
      ghostData: GHOST,
      exportedAt: Date.now(),
      splits: [{ segmentIndex: 0, tMs: -5, speed: 1 }],
    });
    const result = importGhostFromJson(json, 'meander');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_format');
  });

  it('round-trips launchHour / hydroEventHash / qualityPreset (codec v3)', () => {
    const json = exportGhostToJson('hydro', 75_000, GHOST, undefined, {
      launchHour: 14,
      hydroEventHash: 'abcd1234',
      qualityPreset: 'high',
    });
    const result = importGhostFromJson(json, 'hydro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.launchHour).toBe(14);
    expect(result.file.hydroEventHash).toBe('abcd1234');
    expect(result.file.qualityPreset).toBe('high');
    expect(result.file.codecVersion).toBe(GHOST_CODEC_VERSION);
  });

  it('still imports a v2 file that has no fairness fields', () => {
    const json = JSON.stringify({
      codecVersion: 2,
      mapId: 'meander',
      timeMs: 60_000,
      ghostData: GHOST,
      exportedAt: Date.now(),
    });
    const result = importGhostFromJson(json, 'meander');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.launchHour).toBeUndefined();
    expect(result.file.hydroEventHash).toBeUndefined();
  });

  it('rejects ghost recorded on a different map', () => {
    const json = exportGhostToJson('glacier', 60_000, GHOST);
    const result = importGhostFromJson(json, 'meander');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('map_mismatch');
  });

  it('accepts ghost without expectedMapId check (no filter)', () => {
    const json = exportGhostToJson('glacier', 60_000, GHOST);
    const result = importGhostFromJson(json);
    expect(result.ok).toBe(true);
  });
});
