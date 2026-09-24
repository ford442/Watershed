/**
 * ghostFairnessGate.test.ts — #449 E1: a ghost from a different launch hour or
 * hydro event set is refused (and says why); same hour/hash round-trips.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { encodeGhostSamples, encodeGhostToBase64, type GhostSample } from './ghostCodec';
import {
  buildGhostShareUrl,
  exportGhostToJson,
  ghostShareFilename,
  importGhostFromJson,
} from './ghostExport';
import { buildGhostHydroFairness, judgeGhostFairness } from './hydroFairness';
import type { HydroEvent } from '../water/hydroEvents';
import {
  buildRunKey,
  getRunBest,
  resetPersistenceForTests,
  updatePBGhost,
} from '../persistence/PersistenceSystem';

const PULSE: HydroEvent = { id: 'hydro-dam-pulse', kind: 'inflowPulse', segmentIndex: 4, hours: [14] };
const SAMPLE: GhostSample = { px: 1, py: 2, pz: -3, qx: 0, qy: 0, qz: 0, qw: 1 };
const PAYLOAD = encodeGhostToBase64(encodeGhostSamples([SAMPLE, SAMPLE, SAMPLE]));

const at = (launchHour: number, events: HydroEvent[] = [PULSE], qualityPreset: 'high' | 'low' = 'high') =>
  buildGhostHydroFairness({ launchHour, events, qualityPreset });

describe('judgeGhostFairness', () => {
  it('matches the same hour + hydro set', () => {
    expect(judgeGhostFairness(at(14), at(14), 'rival')).toEqual({ kind: 'match' });
  });

  it('refuses a different launch hour and names both hours', () => {
    const verdict = judgeGhostFairness(at(14), at(6), 'rival');
    expect(verdict.kind).toBe('refused');
    if (verdict.kind !== 'refused') return;
    expect(verdict.reason).toBe('hour_mismatch');
    expect(verdict.message).toBe('rival was H06:00 — you launched H14:00');
  });

  it('refuses the same hour with a different hydro event set', () => {
    const edited: HydroEvent = { ...PULSE, strength: 2 };
    const verdict = judgeGhostFairness(at(14), at(14, [edited]), 'PB');
    expect(verdict.kind).toBe('refused');
    if (verdict.kind === 'refused') expect(verdict.reason).toBe('hydro_mismatch');
  });

  it('labels (does not refuse) a quality-only difference', () => {
    expect(judgeGhostFairness(at(14), at(14, [PULSE], 'low'), 'rival').kind).toBe('match');
  });

  it('races a pre-v3 ghost as unverified', () => {
    expect(judgeGhostFairness(at(14), {}, 'rival').kind).toBe('unverified');
  });
});

describe('importGhostFromJson with expected fairness', () => {
  it('round-trips export → import on the same map/hour/hash', () => {
    const json = exportGhostToJson('lumber', 61_000, PAYLOAD, undefined, at(14));
    const result = importGhostFromJson(json, 'lumber', at(14));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.launchHour).toBe(14);
      expect(result.file.hydroEventHash).toBe(at(14).hydroEventHash);
    }
  });

  it('refuses a ghost from another hour instead of importing it silently', () => {
    const json = exportGhostToJson('lumber', 61_000, PAYLOAD, undefined, at(6));
    const result = importGhostFromJson(json, 'lumber', at(14));
    expect(result).toEqual({
      ok: false,
      reason: 'hour_mismatch',
      message: 'rival was H06:00 — you launched H14:00',
    });
  });

  it('still rejects the wrong map before looking at fairness', () => {
    const json = exportGhostToJson('meander', 61_000, PAYLOAD, undefined, at(6));
    expect(importGhostFromJson(json, 'lumber', at(14))).toEqual({ ok: false, reason: 'map_mismatch' });
  });

  it('accepts a v2 file (no hour/hash) — gated later as unverified', () => {
    const json = JSON.stringify({ codecVersion: 2, mapId: 'lumber', timeMs: 1, ghostData: PAYLOAD, exportedAt: 0 });
    expect(importGhostFromJson(json, 'lumber', at(14)).ok).toBe(true);
  });
});

describe('share link', () => {
  it('names the file by map + hour and links map/hour/ghost same-origin', () => {
    expect(ghostShareFilename('lumber', 14)).toBe('lumber_H14.wsghost');
    expect(ghostShareFilename('lumber')).toBe('lumber.wsghost');
    expect(buildGhostShareUrl({ origin: 'https://test.1ink.us', pathname: '/watershed/' }, 'lumber', 14)).toBe(
      'https://test.1ink.us/watershed/?map=lumber&hour=14&ghost=./lumber_H14.wsghost',
    );
  });
});

describe('PB records its river', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPersistenceForTests();
  });

  it('persists launchHour + hydroEventHash through the persistence schema', () => {
    const key = buildRunKey('lumber', 7);
    const fairness = at(14);
    updatePBGhost(key, 90_000, PAYLOAD, undefined, fairness);
    resetPersistenceForTests(); // force a reload through AJV validation
    const pb = getRunBest(key);
    expect(pb.bestTimeMs).toBe(90_000);
    expect(pb.launchHour).toBe(14);
    expect(pb.hydroEventHash).toBe(fairness.hydroEventHash);
  });

  it('a faster PB without fairness drops the stale hour instead of inheriting it', () => {
    const key = buildRunKey('lumber', 8);
    updatePBGhost(key, 90_000, PAYLOAD, undefined, at(14));
    updatePBGhost(key, 80_000, PAYLOAD);
    expect(getRunBest(key).launchHour).toBeUndefined();
    expect(getRunBest(key).hydroEventHash).toBeUndefined();
  });
});
