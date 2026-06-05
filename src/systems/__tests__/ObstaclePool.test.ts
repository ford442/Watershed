import * as THREE from 'three';
import { createObstaclePool, getPooledObstacle } from '../ObstaclePool';

function createSegment(id: number, zOffset: number, rockDensity = 'high') {
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, zOffset),
    new THREE.Vector3(1, 0, zOffset - 20),
    new THREE.Vector3(-1, 0, zOffset - 40),
    new THREE.Vector3(0, 0, zOffset - 60),
  ]);

  return {
    id,
    type: 'normal',
    segmentPath: path,
    width: 35,
    waterWidth: 12,
    flowSpeed: 1.4,
    rockDensity,
  };
}

describe('ObstaclePool', () => {
  it('reuses fixed slots as segments recycle', () => {
    const pool = createObstaclePool(16);

    const first = pool.syncSegments([
      createSegment(20, 0),
      createSegment(21, -60),
      createSegment(22, -120),
      createSegment(23, -180),
      createSegment(24, -240),
      createSegment(25, -300),
    ]);

    expect(first).toHaveLength(16);
    expect(first.filter((slot) => slot.active).length).toBeLessThanOrEqual(16);
    expect(first.some((slot) => slot.segmentId === 20)).toBe(true);

    const second = pool.syncSegments([
      createSegment(21, -60),
      createSegment(22, -120),
      createSegment(23, -180),
      createSegment(24, -240),
      createSegment(25, -300),
      createSegment(26, -360),
    ]);

    expect(second).toHaveLength(16);
    expect(second.filter((slot) => slot.active).length).toBeLessThanOrEqual(16);
    expect(second.some((slot) => slot.segmentId === 20)).toBe(false);
    expect(second.some((slot) => slot.segmentId === 26)).toBe(true);
  });

  it('exposes getPooledObstacle helper for manual slot assignment', () => {
    const pool = createObstaclePool(12);
    const slot = getPooledObstacle(pool, 'log', new THREE.Vector3(1, 2, 3), {
      key: 'manual-log',
      segmentId: 99,
      scale: 1,
    });

    expect(slot).not.toBeNull();
    expect(slot?.type).toBe('log');
    expect(slot?.position.toArray()).toEqual([1, 2, 3]);
  });
});
