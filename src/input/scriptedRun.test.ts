import { describe, expect, it } from 'vitest';
import type { RootState } from '@react-three/fiber';
import { getScriptedSimTimeSec, stepRootFrames } from './scriptedRun';

function fakeRoot(frameloop: 'never' | 'always') {
  const rendered: number[] = [];
  const timestamps: number[] = [];
  let frame = 0;
  const gl = {
    render() {
      rendered.push(frame);
    },
  };
  const realRender = gl.render;
  const state = {
    frameloop,
    gl,
    advance(timestamp: number) {
      frame += 1;
      timestamps.push(timestamp);
      // What R3F's update() does after the useFrame subscribers.
      gl.render();
    },
  } as unknown as RootState;
  return { state, gl, realRender, rendered, timestamps };
}

describe('stepRootFrames', () => {
  it('advances n fixed-dt frames and renders only the last', () => {
    const root = fakeRoot('never');
    const t0 = getScriptedSimTimeSec();
    expect(stepRootFrames(() => root.state, 60)).toBe(60);
    expect(root.rendered).toEqual([60]);
    expect(root.timestamps).toHaveLength(60);
    for (let i = 1; i < 60; i += 1) {
      expect(root.timestamps[i] - root.timestamps[i - 1]).toBeCloseTo(1 / 60, 12);
    }
    expect(getScriptedSimTimeSec() - t0).toBeCloseTo(1, 9);
    // The renderer's own method is back afterwards.
    expect(root.gl.render).toBe(root.realRender);
  });

  it('refuses to step a live render loop', () => {
    const root = fakeRoot('always');
    expect(stepRootFrames(() => root.state, 10)).toBe(0);
    expect(root.timestamps).toHaveLength(0);
  });
});
