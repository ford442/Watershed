import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { gameEvents, type CaptionDetail } from '../events/GameEvents';
import { captionDirection, captionSound, startHazardCaptions } from './captions';
import { resetAccessRuntimeForTests, setCaptionsEnabled } from '../settings/accessRuntime';

function collect(): { seen: CaptionDetail[]; off: () => void } {
  const seen: CaptionDetail[] = [];
  const off = gameEvents.on('caption', (c) => seen.push({ ...c }));
  return { seen, off };
}

describe('captions (#558 C.3)', () => {
  afterEach(() => resetAccessRuntimeForTests());

  it('says nothing while captions are off', () => {
    const { seen, off } = collect();
    captionSound('water_crash', null);
    off();
    expect(seen).toHaveLength(0);
  });

  it('captions gameplay sounds and skips the rest', () => {
    setCaptionsEnabled(true);
    const { seen, off } = collect();
    captionSound('collide_rock', null);
    captionSound('step_grass', null);
    off();
    expect(seen.map((c) => c.id)).toEqual(['impact']);
  });

  it('gives the side relative to the listener', () => {
    const listener = new THREE.Object3D(); // at the origin looking down −z
    expect(captionDirection(listener, { x: -5, y: 0, z: -1 })).toBe(-1);
    expect(captionDirection(listener, { x: 5, y: 0, z: -1 })).toBe(1);
    expect(captionDirection(listener, { x: 0.2, y: 0, z: -10 })).toBe(0);
    expect(captionDirection(null, { x: 5, y: 0, z: 0 })).toBe(0);
  });

  it('captions a hazard telegraph with its countdown', () => {
    setCaptionsEnabled(true);
    const stop = startHazardCaptions(() => null);
    const { seen, off } = collect();
    gameEvents.emit('hazard-phase', {
      hazardId: 'dam-1',
      kind: 'damRelease',
      segmentIndex: 4,
      phase: 'telegraph',
      anchor: null,
      warnSeconds: 3,
    });
    gameEvents.emit('hazard-phase', { hazardId: 'dam-1', kind: 'damRelease', segmentIndex: 4, phase: 'armed', anchor: null });
    off();
    stop();
    expect(seen).toEqual([{ id: 'damRelease.telegraph', direction: 0, priority: 3, seconds: 3 }]);
  });
});
