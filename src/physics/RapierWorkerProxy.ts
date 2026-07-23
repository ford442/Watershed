import {
  DEFAULT_RAFT_WORKER_INIT,
  RapierWorkerCommand,
  RapierWorkerInitPayload,
  RapierWorkerLike,
  RapierWorkerResponse,
  Vec3Tuple,
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

  get averageLatencyMs(): number {
    return this.latencySamples > 0 ? this.totalLatencyMs / this.latencySamples : 0;
  }

  init(payload: RapierWorkerInitPayload = DEFAULT_RAFT_WORKER_INIT): Promise<WorkerRaftState> {
    return this.request({ type: 'INIT', payload }).then((response) => {
      if (!('state' in response)) throw new Error('INIT did not return raft state');
      return response.state;
    });
  }

  step(delta: number): Promise<WorkerRaftState> {
    return this.request({ type: 'STEP', delta }).then((response) => {
      if (!('state' in response)) throw new Error('STEP did not return raft state');
      return response.state;
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
