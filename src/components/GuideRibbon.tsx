/**
 * GuideRibbon.tsx — the centreline guide assist (#558 D.1).
 *
 * A thin flat ribbon along `SegmentFrame.samples` of the segment under the
 * player and the next two, a little above the path, in the palette's "ok"
 * colour. Rebuilt only when the frames are republished or the player enters a
 * new segment; mounted only while the assist is on.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import {
  getSegmentFrames,
  getSegmentFramesVersion,
  subscribeSegmentFrames,
} from '../systems/map/segmentFrames';
import { useGameStore } from '../systems/GameState';
import { getAccessPalette, subscribeAccess } from '../systems/settings/accessRuntime';

/** Segments drawn, starting at the one under the player. */
const SEGMENTS_AHEAD = 3;
const HALF_WIDTH = 0.18;
const LIFT = 0.35;

export function GuideRibbon(): React.ReactElement {
  const version = useSyncExternalStore(subscribeSegmentFrames, getSegmentFramesVersion, getSegmentFramesVersion);
  const segmentIndex = useGameStore((s) => s.currentSegmentIndex);

  const geometry = useMemo(() => {
    void version;
    const frames = getSegmentFrames()
      .filter((f) => f.index >= segmentIndex && f.index < segmentIndex + SEGMENTS_AHEAD)
      .sort((a, b) => a.index - b.index);
    const points: [number, number, number][] = [];
    for (const f of frames) {
      for (const p of f.samples) {
        const last = points[points.length - 1];
        if (last && last[0] === p[0] && last[1] === p[1] && last[2] === p[2]) continue;
        points.push([p[0], p[1], p[2]]);
      }
    }
    const geo = new THREE.BufferGeometry();
    if (points.length < 2) return geo;
    const pos = new Float32Array(points.length * 2 * 3);
    const index: number[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[Math.max(0, i - 1)];
      const b = points[Math.min(points.length - 1, i + 1)];
      let tx = b[0] - a[0];
      let tz = b[2] - a[2];
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      // Horizontal right = tangent × up.
      const rx = -tz * HALF_WIDTH;
      const rz = tx * HALF_WIDTH;
      const [x, y, z] = points[i];
      pos.set([x - rx, y + LIFT, z - rz, x + rx, y + LIFT, z + rz], i * 6);
      if (i > 0) {
        const k = i * 2;
        index.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(index);
    geo.computeBoundingSphere();
    return geo;
  }, [version, segmentIndex]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: getAccessPalette().ok,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  );
  useEffect(
    () =>
      subscribeAccess(() => {
        material.color.set(getAccessPalette().ok);
      }),
    [material],
  );
  useEffect(() => () => material.dispose(), [material]);

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />;
}

export default GuideRibbon;
