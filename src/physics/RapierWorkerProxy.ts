import { telemetryNowMs } from '../utils/wallClock';
import { registerTraceWorker } from '../debug/trace/traceWorkers';
import { raceWithDeadline, resolveWasmInitTimeoutMs } from '../systems/water/wasmLoader';
import {
  DEFAULT_RAFT_WORKER_INIT,
  RAPIER_WORKER_PROTOCOL_VERSION,
  type RapierWorkerCommand,
  type RapierWorkerInitPayload,
  type RapierWorkerLike,
  type RapierWorkerResponse,
  type StaticColliderSpec,
  staticColliderTransferables,
  type Vec3Tuple,
  type WaterForceDiagnostics,
  type WaterForceTickConfig,
  type WorkerRaftState,
} from './rapierWorkerProtocol';

/** A command as callers write it: every RapierWorkerCommand variant, without the id `request` assigns. */
type RapierWorkerRequest = RapierWorkerCommand extends infer C ? (C extends unknown ? Omit<C, 'id'> : never) : never;

interface PendingRequest {
  startedAt: number;
  resolve: (response: RapierWorkerResponse) => void;
  reject: (error: Error) => void;
}

const now = telemetryNowMs;

/** Why a Rapier worker session is dead. */
export type RapierWorkerFailureKind =
  /** The worker script failed to load, parse, or threw at top level (`'error'`). */
  | 'script-error'
  /** A response could not be deserialized (`'messageerror'`). */
  | 'message-error'
  /** INIT did not answer within the deadline. */
  | 'init-timeout'
  /** The worker chunk speaks a different `RAPIER_WORKER_PROTOCOL_VERSION`. */
  | 'protocol-mismatch'
  | 'disposed';

/** Every rejection from a dead proxy. `kind` says which way it died. */
export class RapierWorkerError extends Error {
  readonly kind: RapierWorkerFailureKind;
  constructor(kind: RapierWorkerFailureKind, message: string) {
    super(message);
    this.name = 'RapierWorkerError';
    this.kind = kind;
  }
}

/** INIT's wire version check, separate from the class for tests. */
export class RapierWorkerProtocolError extends RapierWorkerError {
  readonly expected: number;
  readonly actual: number;
  constructor(expected: number, actual: number) {
    super(
      'protocol-mismatch',
      `Rapier worker speaks protocol ${actual}, main thread expects ${expected} (stale worker chunk?)`,
    );
    this.name = 'RapierWorkerProtocolError';
    this.expected = expected;
    this.actual = actual;
  }
}

/** READY before the field existed: treat as protocol 1. */
const LEGACY_PROTOCOL_VERSION = 1;

export class RapierWorkerProxy {
  private worker: RapierWorkerLike;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private state: WorkerRaftState | null = null;
  private waterForce: WaterForceDiagnostics | null = null;
  private simLinked = false;
  private totalLatencyMs = 0;
  private latencySamples = 0;
  private failure: RapierWorkerError | null = null;
  private readonly initTimeoutMs: number;
  private onError = (event: ErrorEvent) => {
    event.preventDefault?.();
    this.fail(new RapierWorkerError('script-error', `Rapier worker script error: ${event.message || 'unknown'}`));
  };
  private onMessageError = () => {
    this.fail(new RapierWorkerError('message-error', 'Rapier worker sent a message that could not be deserialized'));
  };
  private onMessage = (event: MessageEvent<RapierWorkerResponse>) => {
    const response = event.data;
    const pending = this.pending.get(response.id);
    if (!pending) return;

    this.pending.delete(response.id);
    const latencyMs = now() - pending.startedAt;
    this.totalLatencyMs += latencyMs;
    this.latencySamples += 1;

    if ('state' in response) {
      this.state = response.state;
    }
    if ('waterForce' in response && response.waterForce) {
      this.waterForce = response.waterForce;
    }
    if (response.type === 'ERROR') {
      pending.reject(new Error(response.error));
      return;
    }

    pending.resolve({ ...response, latencyMs });
  };

  /**
   * `initTimeoutMs` bounds INIT (the worker's `RAPIER.init()` + world build);
   * it defaults to the session's WASM init deadline (`?wasmInitTimeout=`).
   */
  constructor(worker: RapierWorkerLike, options: { initTimeoutMs?: number } = {}) {
    this.worker = worker;
    this.initTimeoutMs = options.initTimeoutMs ?? resolveWasmInitTimeoutMs();
    this.worker.addEventListener('message', this.onMessage);
    this.worker.addEventListener('error', this.onError);
    this.worker.addEventListener('messageerror', this.onMessageError);
    // A recording hands the worker a trace port (#559 D). Fire-and-forget: no id, no reply.
    this.untrace = registerTraceWorker('rapier worker', (port) =>
      this.worker.postMessage({ id: -1, type: 'TRACE_CONNECT', port }, [port]),
    );
  }

  private readonly untrace: () => void;

  /** Non-null once the worker has died; it never recovers and every request rejects with it. */
  get failed(): RapierWorkerError | null {
    return this.failure;
  }

  get latestState(): WorkerRaftState | null {
    return this.state;
  }

  get latestWaterForce(): WaterForceDiagnostics | null {
    return this.waterForce;
  }

  /** The worker holds a hull link to the sim worker (its water forces come from there). */
  get isSimLinked(): boolean {
    return this.simLinked;
  }

  get averageLatencyMs(): number {
    return this.latencySamples > 0 ? this.totalLatencyMs / this.latencySamples : 0;
  }

  /**
   * Boot the worker world. Rejects — and kills the proxy — when the worker
   * script fails, INIT misses `initTimeoutMs`, or READY reports a different
   * protocol version: a raft session falls back instead of waiting forever.
   */
  init(payload: RapierWorkerInitPayload = DEFAULT_RAFT_WORKER_INIT): Promise<WorkerRaftState> {
    const handshake = this.request({ type: 'INIT', payload }).then((response) => {
      if (response.type !== 'READY') throw new Error('INIT did not return raft state');
      const version = response.protocolVersion ?? LEGACY_PROTOCOL_VERSION;
      if (version !== RAPIER_WORKER_PROTOCOL_VERSION) {
        throw this.fail(new RapierWorkerProtocolError(RAPIER_WORKER_PROTOCOL_VERSION, version));
      }
      return response.state;
    });
    return raceWithDeadline(handshake, this.initTimeoutMs, () =>
      this.fail(
        new RapierWorkerError('init-timeout', `Rapier worker did not report READY within ${this.initTimeoutMs}ms`),
      ),
    );
  }

  step(
    delta: number,
    options: {
      impulses?: Vec3Tuple[];
      waterForce?: WaterForceTickConfig;
    } = {},
  ): Promise<{ state: WorkerRaftState; waterForce?: WaterForceDiagnostics }> {
    return this.request({
      type: 'STEP',
      delta,
      impulses: options.impulses,
      waterForce: options.waterForce,
    }).then((response) => {
      if (response.type !== 'STATE') throw new Error('STEP did not return raft state');
      return {
        state: response.state,
        waterForce: response.waterForce,
      };
    });
  }

  applyImpulse(impulse: Vec3Tuple, wake = true): Promise<void> {
    return this.request({ type: 'APPLY_IMPULSE', impulse, wake }).then(() => undefined);
  }

  getState(): Promise<WorkerRaftState> {
    return this.request({ type: 'GET_STATE' }).then((response) => {
      if (!('state' in response)) throw new Error('GET_STATE did not return raft state');
      return response.state;
    });
  }

  /**
   * Trimesh/hull buffers are transferred, not copied: pass a spec the caller
   * owns outright (workerColliderRegistry builds a fresh one per send).
   */
  addStaticCollider(collider: StaticColliderSpec, handle?: number): Promise<number> {
    const transfer = staticColliderTransferables(collider);
    return this.request(
      { type: 'ADD_STATIC_COLLIDER', collider, handle },
      transfer.length > 0 ? transfer : undefined,
    ).then((response) => {
      if (response.type !== 'ACK' || response.handle == null) {
        throw new Error('ADD_STATIC_COLLIDER did not return a handle');
      }
      return response.handle;
    });
  }

  removeStaticCollider(handle: number): Promise<void> {
    return this.request({ type: 'REMOVE_STATIC_COLLIDER', handle }).then(() => undefined);
  }

  /** Hand the worker its end of the hull link to the sim worker (#455 Phase B). */
  connectSim(port: MessagePort): Promise<void> {
    return this.request({ type: 'CONNECT_SIM', port }, [port]).then(() => {
      this.simLinked = true;
    });
  }

  clearStaticColliders(): Promise<void> {
    return this.request({ type: 'CLEAR_STATIC_COLLIDERS' }).then(() => undefined);
  }

  dispose(): void {
    this.detach();
    if (!this.failure) this.failure = new RapierWorkerError('disposed', 'Rapier worker disposed');
    this.rejectPending(this.failure);
    this.worker.terminate?.();
  }

  /**
   * Mark the proxy dead (first failure wins), reject everything in flight, and
   * stop the worker. Returns the error that is now the proxy's failure.
   */
  private fail(error: RapierWorkerError): RapierWorkerError {
    if (this.failure) return this.failure;
    this.failure = error;
    console.error('[rapier worker] fatal:', error.message);
    this.detach();
    this.rejectPending(error);
    this.worker.terminate?.();
    return error;
  }

  private detach(): void {
    this.untrace();
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onError);
    this.worker.removeEventListener('messageerror', this.onMessageError);
  }

  private rejectPending(error: Error): void {
    this.pending.forEach((request) => request.reject(error));
    this.pending.clear();
  }

  /**
   * The one postMessage site (#502): `command` is a RapierWorkerCommand minus
   * its id, checked per variant, so a misspelt field or a payload for the
   * wrong type is a compile error rather than a cast.
   */
  private request(command: RapierWorkerRequest, transfer?: Transferable[]): Promise<RapierWorkerResponse> {
    const id = this.nextId++;
    // Re-adding `id` to a distributive Omit is exact, but TS cannot prove it
    // through the spread, hence the one assertion.
    const message = { ...command, id } as RapierWorkerCommand;

    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { startedAt: now(), resolve, reject });
      if (transfer) this.worker.postMessage(message, transfer);
      else this.worker.postMessage(message);
    });
  }
}
