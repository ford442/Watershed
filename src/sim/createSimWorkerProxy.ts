/**
 * createSimWorkerProxy — main-thread side of the sim worker (#455).
 *
 * One worker per session, created on first use and never restarted: the
 * handshake either resolves READY within the WASM init deadline or rejects,
 * and a rejected session stays on the main-thread stepper (one backend per
 * session, never a hang). Nothing here blocks: frames are pushed to the grid
 * that owns them as they arrive, and `latestFrame()` reads the last header.
 */
import {
  raceWithDeadline,
  resolvePublicAsset,
  resolveWasmInitTimeoutMs,
} from '../systems/water/WatershedWasm';
import type { SimFrame, SimFrameHeader } from './SimFrame';
import type { SimWorkerCommand, SimWorkerLike, SimWorkerResponse } from './simWorkerProtocol';

/** Slack over the in-worker WASM deadline for the worker script itself to load. */
const HANDSHAKE_SLACK_MS = 2000;

type FrameListener = (frame: SimFrame) => void;

export class SimWorkerProxy {
  private readonly worker: SimWorkerLike;
  private readonly frameListeners = new Map<number, FrameListener>();
  private readonly fatalListeners = new Set<(error: string) => void>();
  private nextGrid = 1;
  private latest: SimFrameHeader | null = null;
  private readyResolve: ((abi: number) => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private failure: string | null = null;
  private abiVersion = 0;

  private readonly onMessage = (event: MessageEvent<SimWorkerResponse>) => {
    const response = event.data;
    switch (response.type) {
      case 'READY':
        this.abiVersion = response.abi;
        this.readyResolve?.(response.abi);
        this.readyResolve = null;
        this.readyReject = null;
        return;
      case 'FRAME': {
        const { buffer, ...header } = response.frame;
        this.latest = header;
        const listener = this.frameListeners.get(response.frame.gridId);
        if (listener) listener(response.frame);
        else this.returnFrame(buffer);
        return;
      }
      case 'ERROR':
        if (response.fatal) this.fail(response.error);
        else console.warn('[sim worker]', response.error);
        return;
    }
  };

  private readonly onError = (event: ErrorEvent) => {
    event.preventDefault?.();
    this.fail(event.message || 'sim worker script error');
  };

  constructor(worker: SimWorkerLike) {
    this.worker = worker;
    worker.addEventListener('message', this.onMessage);
    worker.addEventListener('error', this.onError);
  }

  /** Handshake: resolves the worker module's ABI, rejects on error or deadline. */
  ready(timeoutMs: number): Promise<number> {
    if (this.failure) return Promise.reject(new Error(this.failure));
    const handshake = new Promise<number>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.post({
      type: 'INIT',
      assets: {
        glue: resolvePublicAsset('watershed_native.js'),
        wasm: resolvePublicAsset('watershed_native.wasm'),
      },
    });
    return raceWithDeadline(
      handshake,
      timeoutMs,
      () => new Error(`sim worker did not report READY within ${timeoutMs}ms`),
    );
  }

  get abi(): number {
    return this.abiVersion;
  }

  /** Non-null once the worker has died; it never recovers. */
  get failed(): string | null {
    return this.failure;
  }

  /** Header of the last frame the worker published (any grid). Never blocks. */
  latestFrame(): SimFrameHeader | null {
    return this.latest;
  }

  allocateGridId(): number {
    return this.nextGrid++;
  }

  post(command: SimWorkerCommand, transfer: Transferable[] = []): void {
    if (this.failure) return;
    this.worker.postMessage(command, transfer);
  }

  returnFrame(buffer: ArrayBuffer): void {
    this.post({ type: 'RETURN_FRAME', buffer }, [buffer]);
  }

  onFrame(gridId: number, listener: FrameListener): () => void {
    this.frameListeners.set(gridId, listener);
    return () => {
      if (this.frameListeners.get(gridId) === listener) this.frameListeners.delete(gridId);
    };
  }

  onFatal(listener: (error: string) => void): () => void {
    this.fatalListeners.add(listener);
    return () => {
      this.fatalListeners.delete(listener);
    };
  }

  dispose(): void {
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onError);
    this.frameListeners.clear();
    this.fatalListeners.clear();
    this.worker.terminate?.();
  }

  private fail(error: string): void {
    if (this.failure) return;
    this.failure = error;
    this.readyReject?.(new Error(error));
    this.readyResolve = null;
    this.readyReject = null;
    console.error('[sim worker] fatal:', error);
    for (const listener of this.fatalListeners) listener(error);
    this.worker.terminate?.();
  }
}

export type SimWorkerFactory = () => SimWorkerLike;

const defaultFactory: SimWorkerFactory = () =>
  new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' }) as unknown as SimWorkerLike;

let proxyPromise: Promise<SimWorkerProxy> | null = null;

/**
 * The session's sim worker, READY. Rejects — and keeps rejecting, so a quality
 * change cannot retry into a half-dead worker — when `Worker` construction
 * throws, the module fails to load, or the handshake misses its deadline.
 */
export function getSimWorkerProxy(factory: SimWorkerFactory = defaultFactory): Promise<SimWorkerProxy> {
  if (!proxyPromise) {
    proxyPromise = (async () => {
      const proxy = new SimWorkerProxy(factory());
      const search = typeof location !== 'undefined' ? location.search : undefined;
      try {
        await proxy.ready(resolveWasmInitTimeoutMs(search) + HANDSHAKE_SLACK_MS);
      } catch (error) {
        proxy.dispose();
        throw error;
      }
      return proxy;
    })();
  }
  return proxyPromise;
}

/** Test seam. */
export function resetSimWorkerProxyForTests(): void {
  proxyPromise = null;
}
