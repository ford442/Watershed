import { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { lazyComponent } from './lazyComponent';
import { whenIdle } from './whenIdle';

describe('lazyComponent', () => {
  it('suspends until the chunk lands, and renders without suspending once it has been preloaded', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const importer = vi.fn(async () => {
      await gate;
      return { default: ({ label }: { label: string }) => <p>{label}</p> };
    });
    const chunk = lazyComponent(importer);

    chunk.preload();
    chunk.preload();
    expect(importer).toHaveBeenCalledTimes(1);

    const first = render(
      <Suspense fallback={<p>loading</p>}>
        <chunk.Component label="menu" />
      </Suspense>,
    );
    expect(screen.getByText('loading')).toBeTruthy();

    release();
    expect(await screen.findByText('menu')).toBeTruthy();
    first.unmount();

    // A later mount (the first PAUSE click) finds the module resolved: no fallback frame.
    render(
      <Suspense fallback={<p>loading</p>}>
        <chunk.Component label="again" />
      </Suspense>,
    );
    expect(await screen.findByText('again')).toBeTruthy();
    expect(screen.queryByText('loading')).toBeNull();
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('swallows a failed preload so the next render can retry it', async () => {
    const importer = vi
      .fn<() => Promise<{ default: () => null }>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ default: () => null });
    const chunk = lazyComponent(importer);
    expect(() => chunk.preload()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    chunk.preload();
    expect(importer).toHaveBeenCalledTimes(2);
  });
});

describe('whenIdle', () => {
  it('falls back to a timer without requestIdleCallback, and cancels', () => {
    vi.useFakeTimers();
    const g = globalThis as { requestIdleCallback?: unknown };
    const saved = g.requestIdleCallback;
    g.requestIdleCallback = undefined;
    try {
      const ran = vi.fn();
      const cancelled = vi.fn();
      whenIdle(ran);
      whenIdle(cancelled)();
      vi.advanceTimersByTime(300);
      expect(ran).toHaveBeenCalledTimes(1);
      expect(cancelled).not.toHaveBeenCalled();
    } finally {
      g.requestIdleCallback = saved;
      vi.useRealTimers();
    }
  });
});
