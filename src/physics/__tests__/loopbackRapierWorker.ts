/**
 * In-process stand-in for rapier.worker.ts: answers every command on a
 * microtask, integrating a raft body with explicit Euler. Shared by the proxy's
 * behaviour test and its latency budget (rapierWorkerProxy.perf.test.ts).
 */
import {
  RAPIER_WORKER_PROTOCOL_VERSION,
  type RapierWorkerCommand,
  type RapierWorkerLike,
  type RapierWorkerResponse,
  type WorkerRaftState,
} from '../rapierWorkerProtocol';

export class LoopbackRapierWorker implements RapierWorkerLike {
  private listeners = new Set<(event: MessageEvent<RapierWorkerResponse>) => void>();
  private state: WorkerRaftState = {
    position: [0, -4, -10],
    rotation: [0, 0, 0, 1],
    velocity: [0, 0, 0],
    angularVelocity: [0, 0, 0],
  };

  transfers: (Transferable[] | undefined)[] = [];
  /** What READY claims — set it to stage a stale worker chunk. */
  protocolVersion = RAPIER_WORKER_PROTOCOL_VERSION;
  private errorListeners = new Set<(event: ErrorEvent) => void>();
  private messageErrorListeners = new Set<(event: MessageEvent) => void>();
  /** Drop every command on the floor (a worker that never answers). */
  silent = false;

  postMessage(message: RapierWorkerCommand, transfer?: Transferable[]): void {
    this.transfers.push(transfer);
    if (this.silent) return;
    queueMicrotask(() => {
      let response: RapierWorkerResponse;

      if (message.type === 'INIT') {
        const position = message.payload?.raft?.position ?? this.state.position;
        this.state = { ...this.state, position: [...position] };
        response = { id: message.id, type: 'READY', state: this.state, protocolVersion: this.protocolVersion };
      } else if (message.type === 'APPLY_IMPULSE') {
        this.state.velocity = [
          this.state.velocity[0] + message.impulse[0] / 150,
          this.state.velocity[1] + message.impulse[1] / 150,
          this.state.velocity[2] + message.impulse[2] / 150,
        ];
        response = { id: message.id, type: 'ACK' };
      } else if (message.type === 'STEP') {
        if (message.impulses) {
          for (const impulse of message.impulses) {
            this.state.velocity = [
              this.state.velocity[0] + impulse[0] / 150,
              this.state.velocity[1] + impulse[1] / 150,
              this.state.velocity[2] + impulse[2] / 150,
            ];
          }
        }
        this.state.position = [
          this.state.position[0] + this.state.velocity[0] * message.delta,
          this.state.position[1] + this.state.velocity[1] * message.delta,
          this.state.position[2] + this.state.velocity[2] * message.delta,
        ];
        response = {
          id: message.id,
          type: 'STATE',
          state: this.state,
          waterForce: message.waterForce?.enabled
            ? {
                source: 'fallback',
                forceX: 1,
                forceY: 2,
                forceZ: 3,
                buoyancy: 4,
                drag: 5,
                flow: 6,
                turbulence: 7,
                submergedRatio: 0.5,
              }
            : undefined,
        };
      } else if (message.type === 'ADD_STATIC_COLLIDER') {
        response = { id: message.id, type: 'ACK', handle: message.handle ?? 42 };
      } else {
        response = { id: message.id, type: 'STATE', state: this.state };
      }

      this.listeners.forEach((listener) => listener({ data: response } as MessageEvent<RapierWorkerResponse>));
    });
  }

  addEventListener(type: 'message', listener: (event: MessageEvent<RapierWorkerResponse>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(type: 'messageerror', listener: (event: MessageEvent) => void): void;
  addEventListener(type: string, listener: (event: never) => void): void {
    this.setFor(type)?.add(listener as never);
  }

  removeEventListener(type: 'message', listener: (event: MessageEvent<RapierWorkerResponse>) => void): void;
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: 'messageerror', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: string, listener: (event: never) => void): void {
    this.setFor(type)?.delete(listener as never);
  }

  /** What the browser does when the worker chunk 404s or throws at top level. */
  emitError(message: string): void {
    const event = { message, preventDefault() {} } as unknown as ErrorEvent;
    this.errorListeners.forEach((listener) => listener(event));
  }

  emitMessageError(): void {
    this.messageErrorListeners.forEach((listener) => listener({} as MessageEvent));
  }

  get listenerCount(): number {
    return this.listeners.size + this.errorListeners.size + this.messageErrorListeners.size;
  }

  terminate(): void {
    this.listeners.clear();
    this.errorListeners.clear();
    this.messageErrorListeners.clear();
  }

  private setFor(type: string): Set<(event: never) => void> | null {
    if (type === 'message') return this.listeners as Set<(event: never) => void>;
    if (type === 'error') return this.errorListeners as Set<(event: never) => void>;
    if (type === 'messageerror') return this.messageErrorListeners as Set<(event: never) => void>;
    return null;
  }
}
