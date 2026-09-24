/**
 * Stale-bounds guard for authored `safeZone`s (#436).
 *
 * A safeZone is segment-relative (see `SafeZoneConfig`), but its margins only
 * make sense for the path the generator actually builds. This walks every
 * registered map through ChunkManager the way TrackManager does — same map
 * manager, start index, seed and forecast-by-index — at the scout hour and the
 * dam hour, and checks each authored zone against the centreline it guards.
 * Editing `verticalBias` / `type` on a set-piece without revisiting its
 * safeZone fails here.
 */

import { describe, expect, it } from 'vitest';
import { ChunkManager } from '../systems/map/ChunkManager';
import { DEFAULT_MAP_CONFIG, ProceduralMapManager } from '../systems/map/MapSystem';
import type { LevelSegment, SafeZoneConfig } from '../systems/map/MapSystem.types';
import {
  buildSegmentFrame,
  resolveSegmentEnvelope,
  type SegmentFrame,
  type VerticalBounds,
} from '../systems/map/segmentFrames';
import { buildForecastSamples, samplesToForecastByIndex } from '../systems/map/flowForecast';
import { DAM_RELEASE_SCHEDULE } from '../experience/constants';
import { POSITION_SANE } from '../vehicles/RunnerVehicle/hooks/runnerAirControl';
import { getMapDefinition, mapRegistryIds, type MapRegistryId } from './registry';

const SCOUT_HOUR = 6;
const DAM_HOUR = 14;

/** Metres a body may sink below the lowest centreline point before wipeout. */
const FLOOR_MARGIN = 8;
/** Waterfall / open-floor segments: the player legitimately drops to the pool. */
const DROP_FLOOR_MARGIN = 15;
/** Metres above the highest centreline point a jump / launch must clear. */
const HEADROOM = 20;
/** Runner spawn height above the path (matches segmentFrames.maps.test). */
const SPAWN_RISE = 1.5;
/** Float slack: a margin authored exactly at the minimum must pass. */
const EPS = 1e-6;

/** The set-piece classes #436 requires a zone on (plus delta's beach). */
const REQUIRED_ZONES: Record<MapRegistryId, number[]> = {
  glacial: [12, 13],
  lumber: [10, 11],
  meander: [14, 15],
  hydro: [5, 6, 7, 8],
  delta: [20, 21],
};

/** Same inputs as useExperienceWorld's default forecast for a launch hour. */
function forecastByIndexAt(launchHour: number): Map<number, string> {
  return samplesToForecastByIndex(
    buildForecastSamples({
      temperature: 8,
      snowpackIndex: 0.65,
      damReleaseSchedule: DAM_RELEASE_SCHEDULE,
      horizonHours: 24,
      startHour: launchHour,
    }),
  );
}

function authoredSegments(mapId: MapRegistryId): LevelSegment[] {
  return getMapDefinition(mapId).levelData.segments.filter((seg) => seg.safeZone);
}

/** Drive the treadmill with a camera riding each segment's midpoint; keep every frame. */
function walkMap(mapId: MapRegistryId, launchHour: number, throughIndex: number): SegmentFrame[] {
  const def = getMapDefinition(mapId);
  const manager = new ProceduralMapManager(def.levelData, def.fallbackProgression, {}, def.continuation ?? null);
  const chunks = new ChunkManager({
    mapManager: manager,
    startIndex: def.startIndex,
    proceduralBaseSeed: DEFAULT_MAP_CONFIG.seed,
    forecastByIndex: forecastByIndexAt(launchHour),
  });
  chunks.initializePool();

  const frames = new Map<number, SegmentFrame>();
  const record = () => {
    for (const segment of chunks.getActiveSegments()) {
      if (!frames.has(segment.id)) {
        frames.set(
          segment.id,
          buildSegmentFrame(segment.id, segment.segmentPath, manager.getChunkConfig(segment.id).safeZone),
        );
      }
    }
  };
  record();
  let cursor = def.startIndex;
  for (let step = 0; step < 400 && !frames.has(throughIndex + 1); step += 1) {
    const active = chunks.getActiveSegments();
    const segment = active.find((s) => s.id === cursor) ?? active.at(-1)!;
    chunks.update(segment.segmentPath.getPoint(0.5).z);
    record();
    cursor += 1;
  }
  return [...frames.values()].sort((a, b) => a.index - b.index);
}

/** World bounds for `frame` under its own margins — the rule in resolveSegmentEnvelope. */
function effectiveBounds(frames: SegmentFrame[], frame: SegmentFrame): VerticalBounds {
  const margins: VerticalBounds = frame.safeZone ?? POSITION_SANE;
  const upstream = frames.find((f) => f.index === frame.index - 1);
  const ceiling = Math.max(frame.pathYMax, upstream?.pathYMax ?? -Infinity);
  return { yMin: frame.pathYMin + margins.yMin, yMax: ceiling + margins.yMax };
}

function isDropSegment(seg: LevelSegment): boolean {
  return seg.type === 'waterfall' || Boolean((seg as { openFloor?: boolean }).openFloor);
}

describe('authored safeZones cover the #436 set-pieces', () => {
  it.each(mapRegistryIds())('%s', (mapId) => {
    const authored = authoredSegments(mapId).map((seg) => seg.index);
    for (const index of REQUIRED_ZONES[mapId] ?? []) {
      expect(authored, `${mapId} seg ${index} authors a safeZone`).toContain(index);
    }
  });
});

describe.each(mapRegistryIds())('%s safeZones against the generated path', (mapId) => {
  const segments = authoredSegments(mapId);
  const throughIndex = Math.max(-Infinity, ...segments.map((seg) => seg.index));
  const walks = segments.length
    ? { [SCOUT_HOUR]: walkMap(mapId, SCOUT_HOUR, throughIndex), [DAM_HOUR]: walkMap(mapId, DAM_HOUR, throughIndex) }
    : null;

  it('the launch hour does not move the centreline under an authored zone', () => {
    if (!walks) return;
    for (const seg of segments) {
      const scout = walks[SCOUT_HOUR].find((f) => f.index === seg.index);
      const dam = walks[DAM_HOUR].find((f) => f.index === seg.index);
      expect(scout, `${mapId} seg ${seg.index} generated`).toBeDefined();
      expect(dam!.samples).toEqual(scout!.samples);
    }
  });

  describe.each([SCOUT_HOUR, DAM_HOUR])('at %i:00', (hour) => {
    it.each(segments.map((seg) => [seg.index, seg] as const))(
      'seg %i: floor, headroom and respawn point hold',
      (index, seg) => {
        const frames = walks![hour];
        const frame = frames.find((f) => f.index === index)!;
        expect(frame, `${mapId} seg ${index} generated`).toBeDefined();
        const zone = frame.safeZone as SafeZoneConfig;
        expect(zone).toEqual(seg.safeZone);

        // The runtime resolves this segment's envelope for a body over its midpoint.
        const mid = frame.samples[Math.floor(frame.samples.length / 2)];
        const envelope = resolveSegmentEnvelope(frames, { z: mid[2] }, POSITION_SANE);
        expect(envelope.segmentIndex).toBe(index);
        expect(envelope.authored).toBe(true);

        const floor = isDropSegment(seg) ? DROP_FLOOR_MARGIN : FLOOR_MARGIN;
        expect(envelope.yMin + floor, `${mapId} seg ${index} floor margin`).toBeLessThanOrEqual(frame.pathYMin + EPS);
        expect(frame.pathYMax + HEADROOM, `${mapId} seg ${index} headroom`).toBeLessThanOrEqual(envelope.yMax + EPS);

        // respawnAt: a generated segment at or upstream of this one…
        const respawnAt = zone.respawnAt;
        if (respawnAt === undefined) return;
        expect(Number.isInteger(respawnAt)).toBe(true);
        expect(respawnAt).toBeLessThanOrEqual(index);
        const respawnFrame = frames.find((f) => f.index === respawnAt);
        expect(respawnFrame, `${mapId} respawn seg ${respawnAt} has a spawn point`).toBeDefined();

        // …whose spawn point (path start) is inside that segment's own bounds
        // and whatever envelope the runtime resolves there — no wipeout loop.
        const [, sy, sz] = respawnFrame!.samples[0];
        const own = effectiveBounds(frames, respawnFrame!);
        expect(sy, `${mapId} respawn ${respawnAt} above its floor`).toBeGreaterThanOrEqual(own.yMin);
        expect(sy + SPAWN_RISE, `${mapId} respawn ${respawnAt} under its ceiling`).toBeLessThanOrEqual(own.yMax);
        const atSpawn = resolveSegmentEnvelope(frames, { z: sz }, POSITION_SANE);
        expect(sy).toBeGreaterThanOrEqual(atSpawn.yMin);
        expect(sy + SPAWN_RISE).toBeLessThanOrEqual(atSpawn.yMax);
      },
    );
  });
});
