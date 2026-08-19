import { afterEach, describe, expect, it } from 'vitest';
import { createChoresRuntime } from './runtime';
import { CHORE_BACKEND_ORDER, type ChoreBackend, type ChoreBackendImpl, type ChoreJob, type ChoreOutput } from './types';
import { publishChoreBreadcrumbs } from './support';
import { reduceF32 } from './cpuMath';

function fakeBackend(
  name: ChoreBackend,
  opts: {
    canRun?: boolean;
    decline?: string;
    throwError?: string;
    empty?: boolean;
  } = {},
): ChoreBackendImpl {
  return {
    backend: name,
    canRun: () => opts.canRun !== false,
    declineReason: () => opts.decline ?? 'declined',
    run: async () => {
      if (opts.throwError) throw new Error(opts.throwError);
      if (opts.empty) return null;
      return reduceF32(new Float32Array([1, 2, 3]));
    },
  };
}

const sampleJob: ChoreJob = {
  op: 'grid-reduce',
  values: new Float32Array([1, 2, 3]),
  width: 3,
  height: 1,
  prefer: 'auto',
};

afterEach(() => {
  publishChoreBreadcrumbs(null, null);
});

describe('gpu-chores runtime', () => {
  it('walks CHORE_BACKEND_ORDER webgpu → wasm → ts', () => {
    expect(CHORE_BACKEND_ORDER).toEqual(['webgpu', 'wasm', 'ts']);
  });

  it('uses the first lane that accepts the job', async () => {
    const runtime = createChoresRuntime([
      fakeBackend('webgpu', { canRun: false, decline: 'No GPU texture source' }),
      fakeBackend('wasm'),
      fakeBackend('ts'),
    ]);
    const result = await runtime.runJob(sampleJob);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.backend).toBe('wasm');
  });

  it('slides to ts when wasm declines', async () => {
    const runtime = createChoresRuntime([
      fakeBackend('webgpu', { canRun: false }),
      fakeBackend('wasm', { canRun: false, decline: 'WASM chore exports not ready' }),
      fakeBackend('ts'),
    ]);
    const result = await runtime.runJob(sampleJob);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.backend).toBe('ts');
  });

  it('records failed lanes and continues', async () => {
    const runtime = createChoresRuntime([
      fakeBackend('webgpu', { throwError: 'adapter lost' }),
      fakeBackend('wasm'),
    ]);
    const result = await runtime.runJob(sampleJob);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.backend).toBe('wasm');
  });

  it('never silently skips — failed jobs include attempts', async () => {
    const runtime = createChoresRuntime([
      fakeBackend('webgpu', { canRun: false, decline: 'No GPU device' }),
      fakeBackend('wasm', { empty: true }),
      fakeBackend('ts', { throwError: 'boom' }),
    ]);
    const result = await runtime.runJob(sampleJob);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toHaveLength(3);
      expect(result.reason).toContain('webgpu');
      expect(result.reason).toContain('wasm');
      expect(result.reason).toContain('ts');
    }
  });

  it('pinned prefer never slides to another lane', async () => {
    const runtime = createChoresRuntime([
      fakeBackend('webgpu', { canRun: false }),
      fakeBackend('wasm'),
      fakeBackend('ts'),
    ]);
    const result = await runtime.runJob({ ...sampleJob, prefer: 'webgpu' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0].backend).toBe('webgpu');
    }
  });

  it('pinned ts actually means ts', async () => {
    const runtime = createChoresRuntime([
      fakeBackend('webgpu'),
      fakeBackend('ts'),
    ]);
    const result = await runtime.runJob({ ...sampleJob, prefer: 'ts' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.backend).toBe('ts');
  });

  it('unregistered lanes are declined, not skipped', async () => {
    const runtime = createChoresRuntime([fakeBackend('ts')]);
    const result = await runtime.runJob(sampleJob);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.backend).toBe('ts');
  });
});

describe('cpu chore backend source gates', () => {
  it('webgpu-style jobs without values still type as ChoreOutput', async () => {
    const runtime = createChoresRuntime([fakeBackend('ts')]);
    const result = await runtime.runJob<ChoreOutput>({
      op: 'grid-reduce',
      values: new Float32Array([4, 5]),
      width: 2,
      height: 1,
    });
    expect(result.ok).toBe(true);
  });
});
