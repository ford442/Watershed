/**
 * gpuTimer — GPU frame time for the render-scale valve and the debug panel
 * (#466 Phase B).
 *
 * rAF wall time on a vsync-capped 60 Hz display sits at ≈16.7 ms however light
 * the frame is, so a valve fed by it can never see "fast" (< 15.3 ms) and never
 * reopens. GPU time can. Sources, best first:
 *
 *   gpu-query      WebGLRenderer + EXT_disjoint_timer_query_webgl2: a ring of
 *                  TIME_ELAPSED_EXT queries bracketing the whole frame, read
 *                  back 2–4 frames late; disjoint samples are dropped.
 *   gpu-timestamp  WebGPURenderer constructed with `trackTimestamp: true` (the
 *                  WebGL2 backend uses the same extension; native WebGPU needs
 *                  the `timestamp-query` feature). three resolves its own query
 *                  pools; this only asks once per frame.
 *   cpu-fallback   Neither (Safari, many Android GPUs): `gpuMs` stays null and
 *                  the caller runs on CPU work time alone. The debug panel says so.
 *
 * Never nests: one TIME_ELAPSED_EXT query may be active per context, and
 * nothing else in the repo opens one.
 */

export type GpuTimerSource = 'gpu-query' | 'gpu-timestamp' | 'cpu-fallback';

export const GPU_TIMER_SOURCE_LABELS: Record<GpuTimerSource, string> = {
  'gpu-query': 'GPU (timer query)',
  'gpu-timestamp': 'GPU (timestamp)',
  'cpu-fallback': 'CPU fallback — no GPU timer',
};

export interface GpuTimer {
  readonly source: GpuTimerSource;
  /** Most recent resolved GPU frame time (ms), or null when none has resolved / no GPU timer. */
  readonly gpuMs: number | null;
  /** Call at the very start of the frame's GPU work. */
  begin(): void;
  /** Call right after the frame's last render. */
  end(): void;
  dispose(): void;
}

/** In-flight query budget; a frame that would exceed it goes unmeasured. */
export const GPU_QUERY_RING = 4;

interface TimerQueryExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

interface NodeRendererLike {
  isWebGPURenderer?: boolean;
  backend?: { trackTimestamp?: boolean; timestampQueryPool?: Record<string, unknown> };
  resolveTimestampsAsync?: (type?: string) => Promise<number | undefined>;
}

interface WebGLRendererLike {
  getContext?: () => WebGLRenderingContext | WebGL2RenderingContext;
}

const NULL_TIMER: GpuTimer = {
  source: 'cpu-fallback',
  gpuMs: null,
  begin() {},
  end() {},
  dispose() {},
};

function isWebGL2(ctx: unknown): ctx is WebGL2RenderingContext {
  return typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext;
}

/** WebGL2 ring of TIME_ELAPSED_EXT queries. Exported for tests with a fake context. */
export function createQueryTimer(ctx: WebGL2RenderingContext, ext: TimerQueryExt): GpuTimer {
  const pending: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;
  let gpuMs: number | null = null;
  let disposed = false;

  const drain = () => {
    while (pending.length > 0) {
      const query = pending[0];
      if (!ctx.getQueryParameter(query, ctx.QUERY_RESULT_AVAILABLE)) break;
      // Checked after availability, per the extension spec: a disjoint event
      // invalidates every query that was in flight when it happened.
      const disjoint = ctx.getParameter(ext.GPU_DISJOINT_EXT);
      const ns = ctx.getQueryParameter(query, ctx.QUERY_RESULT) as number;
      if (!disjoint && Number.isFinite(ns)) gpuMs = ns / 1e6;
      ctx.deleteQuery(query);
      pending.shift();
    }
  };

  return {
    source: 'gpu-query',
    get gpuMs() {
      return gpuMs;
    },
    begin() {
      if (disposed || active) return;
      drain();
      if (pending.length >= GPU_QUERY_RING) return;
      const query = ctx.createQuery();
      if (!query) return;
      ctx.beginQuery(ext.TIME_ELAPSED_EXT, query);
      active = query;
    },
    end() {
      if (!active) return;
      ctx.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    dispose() {
      disposed = true;
      if (active) {
        ctx.endQuery(ext.TIME_ELAPSED_EXT);
        ctx.deleteQuery(active);
        active = null;
      }
      for (const query of pending) ctx.deleteQuery(query);
      pending.length = 0;
    },
  };
}

/** three's own timestamp pools on the node renderer. Exported for tests. */
export function createTimestampTimer(renderer: NodeRendererLike): GpuTimer {
  let gpuMs: number | null = null;
  let resolving = false;
  let disposed = false;

  return {
    source: 'gpu-timestamp',
    get gpuMs() {
      return gpuMs;
    },
    begin() {},
    end() {
      if (disposed || resolving || !renderer.resolveTimestampsAsync) return;
      resolving = true;
      const pools = renderer.backend?.timestampQueryPool ?? {};
      const types = ['render', 'compute'].filter((type) => pools[type]);
      Promise.all(types.map((type) => renderer.resolveTimestampsAsync!(type)))
        .then((durations) => {
          if (disposed) return;
          const total = durations.reduce<number>((sum, d) => sum + (Number.isFinite(d) ? (d as number) : 0), 0);
          if (total > 0) gpuMs = total;
        })
        .catch(() => {})
        .finally(() => {
          resolving = false;
        });
    },
    dispose() {
      disposed = true;
    },
  };
}

/** Pick the best GPU timer the renderer offers; a no-op timer otherwise. */
export function createGpuTimer(renderer: unknown): GpuTimer {
  const node = renderer as NodeRendererLike | null;
  if (node?.isWebGPURenderer) {
    return node.backend?.trackTimestamp && typeof node.resolveTimestampsAsync === 'function'
      ? createTimestampTimer(node)
      : NULL_TIMER;
  }
  let ctx: unknown = null;
  try {
    ctx = (renderer as WebGLRendererLike | null)?.getContext?.() ?? null;
  } catch {
    return NULL_TIMER;
  }
  if (!isWebGL2(ctx)) return NULL_TIMER;
  const ext = ctx.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null;
  return ext ? createQueryTimer(ctx, ext) : NULL_TIMER;
}
