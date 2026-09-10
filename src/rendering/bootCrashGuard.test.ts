import {
  BOOT_GUARD_KEY,
  FRAMES_TO_HEALTHY,
  beginBootAttempt,
  isBootAttemptOpen,
  markBootHealthy,
  readBootFailure,
  recordBootFailure,
  type BootGuardStorage,
} from './bootCrashGuard';

function memoryStorage(initial: Record<string, string> = {}): BootGuardStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe('bootCrashGuard', () => {
  it('reports a clean first boot and arms the guard', () => {
    const storage = memoryStorage();
    expect(beginBootAttempt(storage)).toBeNull();
    // Armed pessimistically: until a frame is drawn, the assumption is "no frame".
    expect(readBootFailure(storage)?.reason).toBe('no-frame');
    expect(isBootAttemptOpen(storage)).toBe(true);
  });

  it('reports the previous failure when the record survived', () => {
    const storage = memoryStorage();
    beginBootAttempt(storage); // boot 1 starts…
    // …and dies here: no frame, so markBootHealthy never runs.
    expect(beginBootAttempt(storage)?.reason).toBe('no-frame');
  });

  it('clears the record on the first rendered frame, not on a frame count', () => {
    // The whole point of FRAMES_TO_HEALTHY = 1: a cold boot on a slow machine
    // spends real time in shader compile and WASM init, and clamping it for
    // being slow rather than broken is a false positive.
    expect(FRAMES_TO_HEALTHY).toBe(1);

    const storage = memoryStorage();
    beginBootAttempt(storage);
    markBootHealthy(storage);
    expect(isBootAttemptOpen(storage)).toBe(false);
    // The next boot is optimistic again — the clamp is self-healing.
    expect(beginBootAttempt(storage)).toBeNull();
  });

  it.each(['context-lost', 'renderer-throw'] as const)(
    'upgrades the armed record to the specific reason: %s',
    (reason) => {
      const storage = memoryStorage();
      beginBootAttempt(storage);
      recordBootFailure(reason, storage);
      expect(readBootFailure(storage)?.reason).toBe(reason);
      // And the next boot is told which one it was, so the badge can say so.
      expect(beginBootAttempt(storage)?.reason).toBe(reason);
    }
  );

  it('lets a healthy frame clear a recorded context loss', () => {
    // webglcontextrestored bumps the Canvas epoch, the sentinel remounts, and
    // its first frame clears the record the loss handler wrote.
    const storage = memoryStorage();
    beginBootAttempt(storage);
    recordBootFailure('context-lost', storage);
    markBootHealthy(storage);
    expect(beginBootAttempt(storage)).toBeNull();
  });

  it('treats an unparseable record as no evidence rather than a clamp', () => {
    const storage = memoryStorage({ [BOOT_GUARD_KEY]: 'not-json' });
    expect(readBootFailure(storage)).toBeNull();
    expect(beginBootAttempt(storage)).toBeNull();
  });

  it('rejects a record with an unknown reason', () => {
    const storage = memoryStorage({
      [BOOT_GUARD_KEY]: JSON.stringify({ reason: 'vibes', at: 1 }),
    });
    expect(readBootFailure(storage)).toBeNull();
  });

  it('degrades to "no guard" when storage throws', () => {
    const throwing: BootGuardStorage = {
      getItem() {
        throw new Error('SecurityError: storage is disabled');
      },
      setItem() {
        throw new Error('SecurityError: storage is disabled');
      },
      removeItem() {
        throw new Error('SecurityError: storage is disabled');
      },
    };
    expect(() => beginBootAttempt(throwing)).not.toThrow();
    expect(beginBootAttempt(throwing)).toBeNull();
    expect(() => recordBootFailure('context-lost', throwing)).not.toThrow();
    expect(() => markBootHealthy(throwing)).not.toThrow();
    expect(isBootAttemptOpen(throwing)).toBe(false);
  });

  it('is a no-op when there is no storage at all', () => {
    expect(beginBootAttempt(null)).toBeNull();
    expect(isBootAttemptOpen(null)).toBe(false);
    expect(() => recordBootFailure('no-frame', null)).not.toThrow();
    expect(() => markBootHealthy(null)).not.toThrow();
  });

  it('namespaces its key', () => {
    expect(BOOT_GUARD_KEY).toBe('watershed:boot-failure');
  });
});
