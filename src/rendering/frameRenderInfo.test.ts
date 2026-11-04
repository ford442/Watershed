import { describe, expect, it } from 'vitest';
import {
  attachFrameRenderInfo,
  getFrameRenderInfo,
  type RendererInfoLike,
} from './frameRenderInfo';

/** WebGLInfo's shape: render counters that `update` adds to, `reset` clears. */
function fakeInfo(): RendererInfoLike & { draw(triangles: number): void } {
  const info = {
    autoReset: true,
    programs: [] as unknown[],
    render: { calls: 0, triangles: 0, points: 0, lines: 0, frame: 0 },
    reset() {
      info.render.calls = 0;
      info.render.triangles = 0;
      info.render.points = 0;
      info.render.lines = 0;
    },
    /** What one `renderer.render()` does to the counters. */
    draw(triangles: number) {
      if (info.autoReset) info.reset();
      info.render.calls += 1;
      info.render.triangles += triangles;
    },
  };
  return info;
}

function fakeLoop() {
  let before: ((t: number) => void) | null = null;
  let after: ((t: number) => void) | null = null;
  return {
    register: {
      before: (cb: (t: number) => void) => ((before = cb), () => (before = null)),
      after: (cb: (t: number) => void) => ((after = cb), () => (after = null)),
    },
    frame(body: () => void) {
      before?.(0);
      body();
      after?.(0);
    },
    get attached() {
      return before !== null && after !== null;
    },
  };
}

describe('frameRenderInfo', () => {
  it('counts every render of the frame, not only the last pass', () => {
    const info = fakeInfo();
    const loop = fakeLoop();
    const detach = attachFrameRenderInfo(info, loop.register);
    expect(info.autoReset).toBe(false);

    // Scene pass + bloom + output quad.
    loop.frame(() => {
      info.draw(90_000);
      info.draw(2);
      info.draw(2);
    });
    expect(getFrameRenderInfo()).toMatchObject({ frame: 1, calls: 3, triangles: 90_004, programs: 0 });

    // The next frame starts from zero, not from the previous frame's total.
    loop.frame(() => info.draw(10));
    expect(getFrameRenderInfo()).toMatchObject({ frame: 2, calls: 1, triangles: 10 });

    detach();
    expect(info.autoReset).toBe(true);
    expect(loop.attached).toBe(false);
  });

  it('is what three reports without it: only the last render', () => {
    const info = fakeInfo();
    info.draw(90_000);
    info.draw(2);
    expect(info.render.triangles).toBe(2);
  });
});
