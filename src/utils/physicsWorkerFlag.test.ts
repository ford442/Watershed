import {
  isPhysicsWorkerEnabled,
  resolvePhysicsWorker,
  type PhysicsWorkerEnvironment,
} from './physicsWorkerFlag';

/** A browser that can host the worker path, so only the flags under test vary. */
const capable = (over: Partial<PhysicsWorkerEnvironment> = {}): PhysicsWorkerEnvironment => ({
  search: '',
  hasWorker: true,
  hasWasm: true,
  ...over,
});

describe('resolvePhysicsWorker', () => {
  it('defaults ON with no query params on a capable browser', () => {
    expect(resolvePhysicsWorker(capable())).toEqual({
      enabled: true,
      reason: 'default-on',
    });
  });

  it('is killed by ?physicsWorker=0 and legacy ?raftWorker=0', () => {
    expect(resolvePhysicsWorker(capable({ search: '?physicsWorker=0' }))).toEqual({
      enabled: false,
      reason: 'query-off',
    });
    expect(resolvePhysicsWorker(capable({ search: '?raftWorker=0' }))).toEqual({
      enabled: false,
      reason: 'query-off',
    });
  });

  it('lets the kill switch win even over an explicit opt-in preference', () => {
    const decision = resolvePhysicsWorker(
      capable({ search: '?physicsWorker=0', preference: 'on' }),
    );
    expect(decision.enabled).toBe(false);
  });

  it('falls back when the browser lacks Worker or WebAssembly', () => {
    expect(resolvePhysicsWorker(capable({ hasWorker: false }))).toEqual({
      enabled: false,
      reason: 'no-worker',
    });
    expect(resolvePhysicsWorker(capable({ hasWasm: false }))).toEqual({
      enabled: false,
      reason: 'no-wasm',
    });
  });

  it('honours the settings preference, and lets ?physicsWorker=1 override it', () => {
    expect(resolvePhysicsWorker(capable({ preference: 'off' }))).toEqual({
      enabled: false,
      reason: 'setting-off',
    });
    expect(resolvePhysicsWorker(capable({ preference: 'on' }))).toEqual({
      enabled: true,
      reason: 'setting-on',
    });
    expect(
      resolvePhysicsWorker(capable({ preference: 'off', search: '?physicsWorker=1' })),
    ).toEqual({ enabled: true, reason: 'query-on' });
  });

  it('accepts a query string with or without the leading ?', () => {
    expect(resolvePhysicsWorker(capable({ search: 'physicsWorker=0' })).enabled).toBe(false);
  });
});

describe('isPhysicsWorkerEnabled', () => {
  it('still accepts a bare search string (legacy call sites)', () => {
    expect(isPhysicsWorkerEnabled({ ...capable(), search: '?physicsWorker=1' })).toBe(true);
    expect(isPhysicsWorkerEnabled('?physicsWorker=0')).toBe(false);
  });

  it('is false when the environment cannot host a worker', () => {
    expect(isPhysicsWorkerEnabled({ hasWorker: false, search: '' })).toBe(false);
  });
});
