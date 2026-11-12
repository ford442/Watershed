import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useReadOn } from './useReadOn';

describe('useReadOn', () => {
  it('reads once per key and returns the cached value in between', () => {
    let source = 1;
    const read = vi.fn(() => source);
    const { result, rerender } = renderHook(({ version }) => useReadOn(read, [version]), {
      initialProps: { version: 0 },
    });
    expect(result.current).toBe(1);

    source = 2;
    rerender({ version: 0 });
    expect(result.current).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);

    rerender({ version: 1 });
    expect(result.current).toBe(2);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('compares the key element-wise with Object.is', () => {
    const read = vi.fn(() => ({}));
    const river = { id: 'a' };
    const { result, rerender } = renderHook(({ label, r }) => useReadOn(read, [label, r]), {
      initialProps: { label: 'Meander', r: river as object | null },
    });
    const first = result.current;
    rerender({ label: 'Meander', r: river });
    expect(result.current).toBe(first);
    rerender({ label: 'Meander', r: null });
    expect(result.current).not.toBe(first);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
