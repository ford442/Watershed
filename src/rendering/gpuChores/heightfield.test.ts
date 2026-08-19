import { afterEach, describe, expect, it } from 'vitest';
import { getGpuChoreStats, resetGpuChoreStats, setGpuChoreStats, subscribeGpuChoreStats } from './statsStore';
import { resetHeightfieldChoresInFlight, runHeightfieldChores } from './heightfield';
import { resetChoresRuntime } from './createRuntime';
import { resetSessionGpuDevice } from './device';

afterEach(() => {
  resetGpuChoreStats();
  resetHeightfieldChoresInFlight();
  resetChoresRuntime();
  resetSessionGpuDevice();
});

describe('gpu-chores stats store', () => {
  it('notifies subscribers on publish', () => {
    let hits = 0;
    const unsub = subscribeGpuChoreStats(() => {
      hits += 1;
    });
    setGpuChoreStats({ min: 1, max: 2, mean: 1.5, backend: 'ts' });
    expect(getGpuChoreStats().min).toBe(1);
    expect(getGpuChoreStats().backend).toBe('ts');
    expect(hits).toBe(1);
    unsub();
  });
});

describe('heightfield chores', () => {
  it('publishes reduce/hist/thumb for a CPU grid', async () => {
    resetSessionGpuDevice();
    const values = new Float32Array(8);
    values.forEach((_, i) => {
      values[i] = i;
    });
    runHeightfieldChores(values, 4, 2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stats = getGpuChoreStats();
    expect(['ts', 'wasm']).toContain(stats.backend);
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(7);
    expect(stats.mean).toBe(3.5);
    expect(stats.histogram).not.toBeNull();
    expect(stats.thumb).not.toBeNull();
    expect(stats.thumb?.width).toBe(32);
  });
});
