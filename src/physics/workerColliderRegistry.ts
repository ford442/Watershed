/**
 * workerColliderRegistry — the raft worker's view of the level (#465 C2).
 *
 * The Rapier worker's world used to be one authored box at an absolute Y; the
 * raft floated on it through walls and rocks and off the descending centreline.
 * Static colliders now register here as they mount (track segment trimesh,
 * rocks, decorations, pooled obstacles, intact trestle decks) and unregister as
 * they unmount, whether or not a worker exists. `attachColliderRegistry` replays
 * the current set into a worker proxy and streams changes after that.
 *
 * Entries hold a *factory*: nothing is copied out of three.js geometry unless a
 * worker is attached, and each send gets fresh buffers the proxy can transfer.
 *
 * Collision *events* (rock damage, trestle breaks, collision particles) still
 * come from the main-thread mirror body, which the worker's state overwrites.
 */
import { useEffect } from 'react';
import type { StaticColliderSpec } from './rapierWorkerProtocol';

export type StaticColliderFactory = () => StaticColliderSpec;

type RegistryEvent =
  | { type: 'add'; key: string; build: StaticColliderFactory }
  | { type: 'remove'; key: string };

const entries = new Map<string, StaticColliderFactory>();
const listeners = new Set<(event: RegistryEvent) => void>();

const emit = (event: RegistryEvent) => {
  listeners.forEach((listener) => listener(event));
};

/** Register (or replace) the collider under `key`. */
export function registerWorkerCollider(key: string, build: StaticColliderFactory): void {
  entries.set(key, build);
  emit({ type: 'add', key, build });
}

export function unregisterWorkerCollider(key: string): void {
  if (entries.delete(key)) emit({ type: 'remove', key });
}

export function workerColliderKeys(): string[] {
  return [...entries.keys()];
}

/** Resolves once a collider whose key starts with `prefix` is registered. */
export function whenWorkerColliderRegistered(prefix: string): { promise: Promise<void>; cancel: () => void } {
  if (workerColliderKeys().some((key) => key.startsWith(prefix))) {
    return { promise: Promise.resolve(), cancel: () => {} };
  }
  let unsubscribe = () => {};
  const promise = new Promise<void>((resolve) => {
    const listener = (event: RegistryEvent) => {
      if (event.type === 'add' && event.key.startsWith(prefix)) {
        unsubscribe();
        resolve();
      }
    };
    listeners.add(listener);
    unsubscribe = () => listeners.delete(listener);
  });
  return { promise, cancel: () => unsubscribe() };
}

/** Test-only: drop every entry and listener. */
export function resetWorkerColliderRegistry(): void {
  entries.clear();
  listeners.clear();
}

/**
 * Keep `key` registered while mounted. Pass a memoised factory (or null to
 * register nothing); a new factory identity re-registers.
 */
export function useWorkerStaticCollider(key: string, build: StaticColliderFactory | null): void {
  useEffect(() => {
    if (!build) return undefined;
    registerWorkerCollider(key, build);
    return () => unregisterWorkerCollider(key);
  }, [key, build]);
}

/** The slice of RapierWorkerProxy the bridge drives. */
export interface StaticColliderSink {
  addStaticCollider(collider: StaticColliderSpec): Promise<number>;
  removeStaticCollider(handle: number): Promise<void>;
}

export interface ColliderRegistryAttachment {
  /** Every add issued so far has been acknowledged (or failed). */
  settled(): Promise<void>;
  /** Stop streaming. Safe after the proxy is disposed. */
  detach(): void;
}

/** Replay the registry into `sink`, then mirror every add/remove until detached. */
export function attachColliderRegistry(sink: StaticColliderSink): ColliderRegistryAttachment {
  const handles = new Map<string, Promise<number | null>>();
  let detached = false;

  const remove = (key: string) => {
    const handle = handles.get(key);
    if (!handle) return;
    handles.delete(key);
    void handle.then((h) => {
      if (h === null || detached) return;
      sink.removeStaticCollider(h).catch(() => {});
    });
  };

  const add = (key: string, build: StaticColliderFactory) => {
    remove(key);
    let pending: Promise<number | null>;
    try {
      pending = sink.addStaticCollider(build()).catch((error) => {
        if (!detached) console.warn(`[workerColliders] add ${key} failed`, error);
        return null;
      });
    } catch (error) {
      console.warn(`[workerColliders] building ${key} failed`, error);
      pending = Promise.resolve(null);
    }
    handles.set(key, pending);
  };

  for (const [key, build] of entries) add(key, build);

  const listener = (event: RegistryEvent) => {
    if (detached) return;
    if (event.type === 'add') add(event.key, event.build);
    else remove(event.key);
  };
  listeners.add(listener);

  return {
    settled: () => Promise.all(handles.values()).then(() => undefined),
    detach: () => {
      detached = true;
      listeners.delete(listener);
      handles.clear();
    },
  };
}
