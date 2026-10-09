import { afterEach, describe, expect, it } from 'vitest';
import {
  attachGpuTimer,
  beginFrameWork,
  endFrameWork,
  frameWorkMs,
  getFrameWork,
  resetFrameWork,
  summarizeFrameWindow,
} from './frameWork';
import type { GpuTimer } from './gpuTimer';

afterEach(() => resetFrameWork());

const VSYNC_60 = 1000 / 60;
const MISSED = VSYNC_60 * 1.2;
const fill = (n: number, v: number) => Array.from({ length: n }, () => v);

describe('frame work clock', () => {
  it('measures CPU work between the before and after effects', () => {
    beginFrameWork(100);
    endFrameWork(106.5);
    expect(getFrameWork().cpuWorkMs).toBeCloseTo(6.5, 6);
    expect(getFrameWork().source).toBe('cpu-fallback');
    expect(frameWorkMs(getFrameWork())).toBeCloseTo(6.5, 6);
  });

  it('takes the GPU time when it is the larger cost', () => {
    let begun = 0;
    const timer: GpuTimer = {
      source: 'gpu-query',
      gpuMs: 12,
      begin: () => (begun += 1),
      end() {},
      dispose() {},
    };
    attachGpuTimer(timer);
    beginFrameWork(0);
    endFrameWork(4);
    expect(begun).toBe(1);
    expect(getFrameWork()).toMatchObject({ cpuWorkMs: 4, gpuMs: 12, source: 'gpu-query' });
    expect(frameWorkMs(getFrameWork())).toBe(12);
  });
});

describe('summarizeFrameWindow', () => {
  it('reports vsync-quantised FPS but GPU work time at 60 Hz', () => {
    const s = summarizeFrameWindow(fill(60, VSYNC_60), fill(60, 9), { gpuTimed: true, missedFrameMs: MISSED });
    expect(s.fps).toBe(60);
    expect(s.meanWorkMs).toBeCloseTo(9, 6);
    expect(s.workSource).toBe('gpu');
  });

  it('falls back to rAF time when no work was measured (timer not mounted)', () => {
    const s = summarizeFrameWindow(fill(60, 25), fill(60, 0), { gpuTimed: false, missedFrameMs: MISSED });
    expect(s.meanWorkMs).toBe(25);
    expect(s.workSource).toBe('raf');
  });

  it('without a GPU timer, a GPU-bound window still reads slow via rAF', () => {
    // 4 ms of CPU work, but every frame misses vsync: the GPU is the bottleneck.
    const s = summarizeFrameWindow(fill(60, 2 * VSYNC_60), fill(60, 4), { gpuTimed: false, missedFrameMs: MISSED });
    expect(s.workSource).toBe('raf');
    expect(s.meanWorkMs).toBeCloseTo(2 * VSYNC_60, 6);
  });

  it('without a GPU timer, a vsync-capped light window reads its CPU work', () => {
    const s = summarizeFrameWindow(fill(60, VSYNC_60), fill(60, 7), { gpuTimed: false, missedFrameMs: MISSED });
    expect(s.workSource).toBe('cpu');
    expect(s.meanWorkMs).toBe(7);
  });
});
