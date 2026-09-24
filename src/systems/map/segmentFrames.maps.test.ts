/**
 * Shipped-map envelopes and waypoints, measured on the real treadmill.
 *
 * Walks every registered map through ChunkManager exactly as TrackManager does
 * (same map manager, start index and seed), builds the segment frames the
 * runtime publishes, and checks the authoring against the geometry the player
 * actually stands on.
 */

import { describe, expect, it } from 'vitest';
import { ChunkManager } from './ChunkManager';
import { DEFAULT_MAP_CONFIG, ProceduralMapManager } from './MapSystem';
import { buildSegmentFrame, resolveSegmentAnchor, resolveSegmentEnvelope, type SegmentFrame } from './segmentFrames';
import { getMapDefinition, mapRegistryIds, type MapRegistryId } from '../../maps/registry';
import { getMapSurvivalMetadata } from '../../maps/survivalMetadata';
import { POSITION_SANE } from '../../vehicles/RunnerVehicle/hooks/runnerAirControl';

interface Walk {
  manager: ProceduralMapManager;
  frames: SegmentFrame[];
  entered: number[];
}

/** Drive the treadmill with a camera riding the centreline; keep every frame. */
function walkMap(mapId: MapRegistryId, seed: number = DEFAULT_MAP_CONFIG.seed, maxSegments = 26): Walk {
  const def = getMapDefinition(mapId);
  const manager = new ProceduralMapManager(def.levelData, def.fallbackProgression, {}, def.continuation ?? null);
  const entered: number[] = [];
  const chunks = new ChunkManager({
    mapManager: manager,
    startIndex: def.startIndex,
    proceduralBaseSeed: seed,
    callbacks: { onSegmentEnter: (index) => entered.push(index) },
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
  // The camera rides each segment's midpoint in turn; generation keeps up
  // (one append per update) and entry fires as the camera arrives.
  let cursor = def.startIndex;
  for (let step = 0; step < 400 && frames.size < maxSegments; step += 1) {
    const active = chunks.getActiveSegments();
    const segment = active.find((s) => s.id === cursor) ?? active.at(-1)!;
    chunks.update(segment.segmentPath.getPoint(0.5).z);
    record();
    cursor += 1;
  }
  return { manager, frames: [...frames.values()].sort((a, b) => a.index - b.index), entered };
}

const SEEDS = [DEFAULT_MAP_CONFIG.seed, 777];

describe.each(mapRegistryIds())('%s treadmill envelopes', (mapId) => {
  it.each(SEEDS)('never flags a runner on the centreline as out of bounds (seed %i)', (seed) => {
    const { frames } = walkMap(mapId, seed);
    for (const frame of frames) {
      for (const [, y, z] of frame.samples) {
        const envelope = resolveSegmentEnvelope(frames, { z }, POSITION_SANE);
        expect(y, `${mapId} seg ${frame.index} centreline`).toBeGreaterThanOrEqual(envelope.yMin);
        expect(y + 1.5, `${mapId} seg ${frame.index} spawn height`).toBeLessThanOrEqual(envelope.yMax);
      }
    }
  });
});

describe('the track descends past any fixed y clip', () => {
  it('every map drops below the old absolute y = -80 wipeout line within its authored run', () => {
    for (const mapId of mapRegistryIds()) {
      const { frames } = walkMap(mapId, DEFAULT_MAP_CONFIG.seed, 22);
      const lowest = Math.min(...frames.map((frame) => frame.pathYMin));
      expect(lowest, mapId).toBeLessThan(POSITION_SANE.yMin);
    }
  });
});

/** The four set-piece classes the campaign pass authors a safeZone on. */
const SET_PIECES: Array<{ mapId: MapRegistryId; segments: number[]; what: string }> = [
  { mapId: 'glacial', segments: [3, 4, 5, 6, 7, 8, 9, 10], what: 'ice tube' },
  { mapId: 'glacial', segments: [12, 13], what: 'crevasse jump + pool' },
  { mapId: 'lumber', segments: [10, 11], what: 'openFloor/hasBridge gap + landing' },
  { mapId: 'meander', segments: [14, 15], what: 'waterfall + splash pool' },
  { mapId: 'hydro', segments: [4, 5, 6], what: 'stilling basin + vortex' },
];

describe.each(SET_PIECES)('$mapId $what safeZone', ({ mapId, segments }) => {
  const { frames } = walkMap(mapId);
  const checkpoints = new Set((getMapSurvivalMetadata(mapId).checkpoints ?? []).map((cp) => cp.segment));

  it.each(segments)('segment %i: a fall under the floor wipes out to an authored checkpoint', (index) => {
    const frame = frames.find((f) => f.index === index);
    expect(frame, `segment ${index} generated`).toBeDefined();
    const zone = frame!.safeZone;
    expect(zone, `segment ${index} authors a safeZone`).toBeDefined();

    const z = frame!.samples[Math.floor(frame!.samples.length / 2)][2];
    const envelope = resolveSegmentEnvelope(frames, { z }, POSITION_SANE);
    expect(envelope.authored).toBe(true);

    // Tighter than the fallback: the old path was a long fall to −80 (or never).
    expect(envelope.yMin).toBeGreaterThan(frame!.pathYMin + POSITION_SANE.yMin);
    // A body under the envelope respawns on a checkpoint that exists upstream of (or at) the fall.
    expect(envelope.respawnAt).toBeDefined();
    expect(checkpoints.has(envelope.respawnAt!), `respawnAt ${envelope.respawnAt} is a checkpoint`).toBe(true);
    expect(envelope.respawnAt!).toBeLessThanOrEqual(index);
    const respawnFrame = frames.find((f) => f.index === envelope.respawnAt);
    expect(respawnFrame, 'respawn segment was generated (spawn point published)').toBeDefined();

    // The respawn point itself is in bounds — no wipeout loop on arrival.
    const [sx, sy, sz] = respawnFrame!.samples[0];
    const atRespawn = resolveSegmentEnvelope(frames, { z: sz }, POSITION_SANE);
    expect(sy).toBeGreaterThanOrEqual(atRespawn.yMin);
    expect(sy + 1.5).toBeLessThanOrEqual(atRespawn.yMax);
    expect(Number.isFinite(sx)).toBe(true);
  });
});

describe('anchored survival waypoints sit on the bank of the live track', () => {
  const ANCHORED_MAPS: MapRegistryId[] = ['glacial', 'lumber', 'meander', 'hydro'];

  it.each(ANCHORED_MAPS)('%s', (mapId) => {
    const { manager, frames } = walkMap(mapId);
    const meta = getMapSurvivalMetadata(mapId);
    const waypoints = [...(meta.cacheSlots ?? []), ...(meta.portageRoutes ?? [])];
    expect(waypoints.length).toBeGreaterThan(0);

    for (const waypoint of waypoints) {
      expect(waypoint.anchor, `${mapId} ${waypoint.label} is anchored`).toBeDefined();
      expect(waypoint.position, 'no absolute world position').toBeUndefined();
      const config = manager.getChunkConfig(waypoint.segmentIndex);
      const lateral = Math.abs(waypoint.anchor!.lateral);
      // Off the water line, inside the canyon walls.
      expect(lateral, `${waypoint.label} clears the water`).toBeGreaterThan(config.waterWidth / 2);
      expect(lateral, `${waypoint.label} inside the walls`).toBeLessThan(config.width / 2);

      const frame = frames.find((f) => f.index === waypoint.segmentIndex)!;
      const [x, , z] = resolveSegmentAnchor(frame, waypoint.anchor!);
      const [cx, , cz] = resolveSegmentAnchor(frame, { ...waypoint.anchor!, lateral: 0 });
      expect(Math.hypot(x - cx, z - cz)).toBeCloseTo(lateral, 3);
    }
  });
});

describe('segment entry follows the player, not generation', () => {
  it('enters each segment in order as the camera reaches it', () => {
    const { entered } = walkMap('lumber', DEFAULT_MAP_CONFIG.seed, 18);
    expect(entered.length).toBeGreaterThan(5);
    entered.forEach((index, i) => {
      if (i > 0) expect(index).toBe(entered[i - 1] + 1);
    });
  });

  it('does not enter a segment the camera has not reached', () => {
    const def = getMapDefinition('glacial');
    const manager = new ProceduralMapManager(def.levelData, def.fallbackProgression, {}, def.continuation ?? null);
    const entered: number[] = [];
    const chunks = new ChunkManager({
      mapManager: manager,
      startIndex: def.startIndex,
      callbacks: { onSegmentEnter: (index) => entered.push(index) },
    });
    chunks.initializePool();
    const [first, second] = chunks.getActiveSegments();
    chunks.update(first.segmentPath.getPoint(0.5).z);
    expect(entered).toEqual([first.id]);

    // Generation runs ~150 m ahead; entry must still wait for the camera.
    const newest = chunks.getActiveSegments().at(-1)!;
    chunks.update(second.segmentPath.getPoint(0.5).z);
    expect(entered).toEqual([first.id, second.id]);
    expect(entered).not.toContain(newest.id);
  });
});
