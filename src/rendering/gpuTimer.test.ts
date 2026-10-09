import { describe, expect, it } from 'vitest';
import { GPU_QUERY_RING, createGpuTimer, createQueryTimer, createTimestampTimer } from './gpuTimer';

const EXT = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };

/** A WebGL2 context double: queries resolve when `resolve()` is called. */
function fakeContext() {
  let nextId = 0;
  const queries = new Map<number, { available: boolean; ns: number }>();
  const log: string[] = [];
  let disjoint = false;
  const ctx = {
    QUERY_RESULT: 0x8866,
    QUERY_RESULT_AVAILABLE: 0x8867,
    createQuery: () => {
      const id = ++nextId;
      queries.set(id, { available: false, ns: 0 });
      return id as unknown as WebGLQuery;
    },
    beginQuery: (_t: number, q: unknown) => log.push(`begin ${q}`),
    endQuery: () => log.push('end'),
    deleteQuery: (q: unknown) => queries.delete(q as number),
    getParameter: (p: number) => (p === EXT.GPU_DISJOINT_EXT ? disjoint : null),
    getQueryParameter: (q: unknown, p: number) => {
      const entry = queries.get(q as number)!;
      return p === ctx.QUERY_RESULT_AVAILABLE ? entry.available : entry.ns;
    },
  };
  return {
    ctx: ctx as unknown as WebGL2RenderingContext,
    log,
    queries,
    resolve(id: number, ms: number) {
      const entry = queries.get(id)!;
      entry.available = true;
      entry.ns = ms * 1e6;
    },
    setDisjoint(v: boolean) {
      disjoint = v;
    },
  };
}

describe('createQueryTimer (EXT_disjoint_timer_query_webgl2)', () => {
  it('reports a frame once its query resolves, a few frames late', () => {
    const f = fakeContext();
    const timer = createQueryTimer(f.ctx, EXT);
    expect(timer.source).toBe('gpu-query');
    timer.begin();
    timer.end();
    expect(timer.gpuMs).toBeNull();
    f.resolve(1, 9.5);
    timer.begin(); // drains before opening the next query
    timer.end();
    expect(timer.gpuMs).toBeCloseTo(9.5, 6);
    expect(f.queries.has(1)).toBe(false);
  });

  it('drops samples taken across a disjoint event', () => {
    const f = fakeContext();
    const timer = createQueryTimer(f.ctx, EXT);
    timer.begin();
    timer.end();
    f.resolve(1, 4);
    f.setDisjoint(true);
    timer.begin();
    expect(timer.gpuMs).toBeNull();
  });

  it('never has more than the ring in flight, and never nests', () => {
    const f = fakeContext();
    const timer = createQueryTimer(f.ctx, EXT);
    for (let i = 0; i < GPU_QUERY_RING + 3; i += 1) {
      timer.begin();
      timer.begin(); // a second begin in the same frame is ignored
      timer.end();
    }
    expect(f.log.filter((l) => l.startsWith('begin'))).toHaveLength(GPU_QUERY_RING);
    timer.dispose();
    expect(f.queries.size).toBe(0);
  });
});

describe('createTimestampTimer (node renderer)', () => {
  it('sums render + compute pools once per frame and skips while a resolve is pending', async () => {
    const calls: string[] = [];
    const renderer = {
      isWebGPURenderer: true,
      backend: { trackTimestamp: true, timestampQueryPool: { render: {}, compute: {} } },
      resolveTimestampsAsync: (type?: string) => {
        calls.push(type ?? 'render');
        return Promise.resolve(type === 'compute' ? 1.5 : 6);
      },
    };
    const timer = createTimestampTimer(renderer);
    timer.end();
    timer.end(); // still resolving — ignored
    expect(calls).toEqual(['render', 'compute']);
    await new Promise((r) => setTimeout(r, 0));
    expect(timer.gpuMs).toBeCloseTo(7.5, 6);
  });
});

describe('createGpuTimer', () => {
  it('falls back to the CPU when the renderer offers no GPU timer', () => {
    expect(createGpuTimer(null).source).toBe('cpu-fallback');
    expect(createGpuTimer({ getContext: () => ({}) }).source).toBe('cpu-fallback');
    expect(createGpuTimer({ isWebGPURenderer: true, backend: { trackTimestamp: false } }).source).toBe('cpu-fallback');
  });

  it('uses three timestamps on a node renderer constructed with trackTimestamp', () => {
    const renderer = {
      isWebGPURenderer: true,
      backend: { trackTimestamp: true },
      resolveTimestampsAsync: () => Promise.resolve(1),
    };
    expect(createGpuTimer(renderer).source).toBe('gpu-timestamp');
  });
});
