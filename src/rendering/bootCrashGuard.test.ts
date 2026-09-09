import {
  BOOT_GUARD_KEY,
  HEALTHY_FRAME_COUNT,
  beginBootAttempt,
  isBootAttemptOpen,
  markBootHealthy,
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
  it('reports a clean first boot and marks the attempt in progress', () => {
    const storage = memoryStorage();
    expect(beginBootAttempt(storage)).toBe(false);
    expect(isBootAttemptOpen(storage)).toBe(true);
  });

  it('reports a failed previous boot when the flag survived', () => {
    const storage = memoryStorage();
    beginBootAttempt(storage); // boot 1 starts…
    // …and dies here: no frames, so markBootHealthy never runs.
    expect(beginBootAttempt(storage)).toBe(true);
  });

  it('clears the flag once the render loop reaches a steady frame rate', () => {
    const storage = memoryStorage();
    beginBootAttempt(storage);
    markBootHealthy(storage);
    expect(isBootAttemptOpen(storage)).toBe(false);
    // The next boot is optimistic again — the clamp is self-healing.
    expect(beginBootAttempt(storage)).toBe(false);
  });

  it('waits about a second of frames before calling a boot healthy', () => {
    expect(HEALTHY_FRAME_COUNT).toBe(60);
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
    expect(beginBootAttempt(throwing)).toBe(false);
    expect(() => markBootHealthy(throwing)).not.toThrow();
    expect(isBootAttemptOpen(throwing)).toBe(false);
  });

  it('is a no-op when there is no storage at all', () => {
    expect(beginBootAttempt(null)).toBe(false);
    expect(isBootAttemptOpen(null)).toBe(false);
    expect(() => markBootHealthy(null)).not.toThrow();
  });

  it('namespaces its key', () => {
    expect(BOOT_GUARD_KEY).toBe('watershed:boot-in-progress');
  });
});
