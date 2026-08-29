import { describe, expect, it } from 'vitest';
import { LIVE_SWE_BACKEND, resolveSweSimBackend } from './sweBackend';

describe('sweBackend', () => {
  it('exposes a single live WASM backend until Phase D', () => {
    expect(LIVE_SWE_BACKEND).toBe('wasm');
    expect(resolveSweSimBackend()).toBe('wasm');
  });
});
