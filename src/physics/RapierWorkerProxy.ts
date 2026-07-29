import {
  DEFAULT_RAFT_WORKER_INIT,
  RapierWorkerCommand,
  RapierWorkerInitPayload,
  RapierWorkerLike,
  RapierWorkerResponse,
  StaticBoxColliderSpec,
  Vec3Tuple,
  WaterForceDiagnostics,
  WaterForceTickConfig,
  WorkerRaftState,
} from './rapierWorkerProtocol';

interface PendingRequest {
  startedAt: number;
  resolve: (response: RapierWorkerResponse) => void;
  reject: (error: Error) => void;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class RapierWorkerProxy {
  private worker: RapierWorkerLike;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private state: WorkerRaftState | null = null;
  private waterForce: WaterForceDiagnostics | null = null;
  private wasmAvailable = false;
  private totalLatencyMs = 0;
  private latencySamples = 0;
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
    if (response.type === 'READY' && 'wasmAvailable' in response) {
      this.wasmAvailable = Boolean(response.wasmAvailable);
    }

    if (response.type === 'ERROR') {
      pending.reject(new Error(response.error));
      return;
    }

    pending.resolve({ ...response, latencyMs });
  };

  constructor(worker: RapierWorkerLike) {
    this.worker = worker;
    this.worker.addEventListener('message', this.onMessage);
  }

  get latestState(): WorkerRaftState | null {
    return this.state;
  }

  get latestWaterForce(): WaterForceDiagnostics | null {
    return this.waterForce;
  }

  get isWasmAvailable(): boolean {
    return this.wasmAvailable;
  }

  get averageLatencyMs(): number {
    return this.latencySamples > 0 ? this.totalLatencyMs / this.latencySamples : 0;
  }

  init(payload: RapierWorkerInitPayload = DEFAULT_RAFT_WORKER_INIT): Promise<WorkerRaftState> {
    return this.request({ type: 'INIT', payload }).then((response) => {
      if (!('state' in response)) throw new Error('INIT did not return raft state');
      if (response.type === 'READY') {
        this.wasmAvailable = Boolean(response.wasmAvailable);
      }
      return response.state;
    });
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

  addStaticCollider(collider: StaticBoxColliderSpec, handle?: number): Promise<number> {
    return this.request({ type: 'ADD_STATIC_COLLIDER', collider, handle }).then((response) => {
      if (response.type !== 'ACK' || response.handle == null) {
        throw new Error('ADD_STATIC_COLLIDER did not return a handle');
      }
      return response.handle;
    });
  }

  removeStaticCollider(handle: number): Promise<void> {
    return this.request({ type: 'REMOVE_STATIC_COLLIDER', handle }).then(() => undefined);
  }

  clearStaticColliders(): Promise<void> {
    return this.request({ type: 'CLEAR_STATIC_COLLIDERS' }).then(() => undefined);
  }

  dispose(): void {
    this.worker.removeEventListener('message', this.onMessage);
    this.pending.forEach((request) => request.reject(new Error('Rapier worker disposed')));
    this.pending.clear();
    this.worker.terminate?.();
  }

  private request(command: Record<string, unknown> & { type: RapierWorkerCommand['type'] }): Promise<RapierWorkerResponse> {
    const id = this.nextId++;
    const message = { ...command, id } as RapierWorkerCommand;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { startedAt: now(), resolve, reject });
      this.worker.postMessage(message);
    });
  }
}

export default RapierWorkerProxy;
