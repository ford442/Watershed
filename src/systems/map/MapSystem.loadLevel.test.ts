/**
 * JSONMapManager.loadLevel builds its main curve from the authored waypoints
 * (`number[][]` tuples). The chunks it samples from that curve must be finite:
 * a curve fed raw tuples reads `.x/.y/.z` off arrays and yields NaN.
 *
 * Nothing in a run reads these chunks (ProceduralMapManager and shelfLaunch only
 * call getChunkConfig; the treadmill builds paths with buildProceduralSegment),
 * so this pins the manager's own contract rather than a gameplay output.
 */

import { JSONMapManager, type LevelData } from './MapSystem';
import mapData from '../../maps/meander_to_waterfall.json';

const level = mapData as unknown as LevelData;

function isFiniteVec(v: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

describe('JSONMapManager.loadLevel — meander', () => {
  it('samples finite chunk points, centres and lengths from the authored waypoints', () => {
    const manager = new JSONMapManager(level);
    expect(manager.chunks.length).toBeGreaterThan(0);
    for (const chunk of manager.chunks) {
      expect(chunk.pathPoints).toHaveLength(4);
      for (const p of chunk.pathPoints) expect(isFiniteVec(p)).toBe(true);
      expect(isFiniteVec(chunk.position)).toBe(true);
      expect(Number.isFinite(chunk.length)).toBe(true);
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it('starts chunk 0 on the first authored waypoint', () => {
    const manager = new JSONMapManager(level);
    const [x, y, z] = level.world.track.waypoints[0];
    const p0 = manager.chunks[0].pathPoints[0];
    expect(p0.x).toBeCloseTo(x);
    expect(p0.y).toBeCloseTo(y);
    expect(p0.z).toBeCloseTo(z);
  });

  it('leaves the authored waypoints as number tuples (no Vector3 written back)', () => {
    new JSONMapManager(level);
    for (const wp of level.world.track.waypoints) expect(Array.isArray(wp)).toBe(true);
  });
});
