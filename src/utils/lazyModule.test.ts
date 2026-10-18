import { describe, expect, it, vi } from 'vitest';
import { lazyModule } from './lazyModule';

describe('lazyModule', () => {
  it('imports once, joins concurrent loads, and exposes the module synchronously after', async () => {
    const importer = vi.fn(async () => ({ answer: 42 }));
    const lazy = lazyModule(importer);
    expect(lazy.get()).toBeNull();
    const [a, b] = await Promise.all([lazy.load(), lazy.load()]);
    expect(a).toBe(b);
    expect(lazy.get()).toBe(a);
    await lazy.load();
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed import so the next load retries', async () => {
    const importer = vi.fn<() => Promise<{ ok: true }>>()
      .mockRejectedValueOnce(new Error('chunk fetch failed'))
      .mockResolvedValueOnce({ ok: true });
    const lazy = lazyModule(importer);
    await expect(lazy.load()).rejects.toThrow('chunk fetch failed');
    expect(lazy.get()).toBeNull();
    await expect(lazy.load()).resolves.toEqual({ ok: true });
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('reset drops the cache', async () => {
    const lazy = lazyModule(async () => ({}));
    await lazy.load();
    lazy.reset();
    expect(lazy.get()).toBeNull();
  });
});
