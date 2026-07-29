import { RapierWorkerProxy } from './RapierWorkerProxy';
import {
  RapierWorkerCommand,
  RapierWorkerLike,
  RapierWorkerResponse,
  WorkerRaftState,
} from './rapierWorkerProtocol';

class LoopbackRapierWorker implements RapierWorkerLike {
  private listeners = new Set<(event: MessageEvent<RapierWorkerResponse>) => void>();
  private state: WorkerRaftState = {
    position: [0, -4, -10],
    rotation: [0, 0, 0, 1],
    velocity: [0, 0, 0],
    angularVelocity: [0, 0, 0],
  };

  postMessage(message: RapierWorkerCommand): void {
    queueMicrotask(() => {
      let response: RapierWorkerResponse;

      if (message.type === 'INIT') {
        const position = message.payload?.raft?.position ?? this.state.position;
        this.state = { ...this.state, position: [...position] };
        response = { id: message.id, type: 'READY', state: this.state, wasmAvailable: false };
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

  addEventListener(_type: 'message', listener: (event: MessageEvent<RapierWorkerResponse>) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent<RapierWorkerResponse>) => void): void {
    this.listeners.delete(listener);
  }

  terminate(): void {
    this.listeners.clear();
  }
}

describe('RapierWorkerProxy', () => {
  it('round-trips raft spawn, paddle impulse, step, and state under 2ms on loopback', async () => {
    const proxy = new RapierWorkerProxy(new LoopbackRapierWorker());

    const initial = await proxy.init({
      raft: {
        position: [0, -4, -10],
        halfExtents: [1, 0.15, 1.5],
        mass: 150,
        linearDamping: 2,
        angularDamping: 2.5,
      },
      staticColliders: [
        {
          position: [0, -4.5, -10],
          halfExtents: [20, 0.25, 40],
        },
      ],
    });
    expect(initial.position).toEqual([0, -4, -10]);

    await proxy.applyImpulse([0, 0, -14]);
    const afterStep = await proxy.step(1 / 60, {
      impulses: [[0, 0, -2]],
      waterForce: {
        enabled: true,
        flowSpeed: 4,
        waterLevel: 0.5,
        raftMass: 150,
        raftVolume: 1.2,
        dragCoefficient: 0.47,
        frontalArea: 1,
        sideArea: 1,
        timeSeconds: 1,
        turbulenceStrength: 0.1,
        turbulenceFrequency: 2,
        flowDirX: 0,
        flowDirZ: -1,
      },
    });
    const state = await proxy.getState();

    expect(afterStep.state.velocity[2]).toBeLessThan(0);
    expect(afterStep.waterForce?.submergedRatio).toBe(0.5);
    expect(state.position[2]).toBeLessThan(-10);
    expect(proxy.averageLatencyMs).toBeLessThan(2);

    const handle = await proxy.addStaticCollider({
      position: [0, -5, 0],
      halfExtents: [2, 0.2, 2],
    });
    expect(handle).toBe(42);

    proxy.dispose();
  });
});
