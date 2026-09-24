import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudioUnlockGate, type AudioUnlockGate } from './audioUnlock';

let gate: AudioUnlockGate | null = null;

afterEach(() => {
  gate?.dispose();
  gate = null;
});

describe('audio unlock gate', () => {
  it('stays closed until a gesture, then fires each listener once', () => {
    gate = createAudioUnlockGate();
    const fn = vi.fn();
    gate.onUnlock(fn);
    expect(gate.unlocked).toBe(false);
    expect(fn).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('keydown'));
    expect(gate.unlocked).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('opens on Enter (keydown) — the Start shortcut', () => {
    gate = createAudioUnlockGate();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(gate.unlocked).toBe(true);
  });

  it('opens on pointer lock, but not on pointer-lock release', () => {
    const doc = new EventTarget() as EventTarget & { pointerLockElement: Element | null };
    doc.pointerLockElement = null;
    gate = createAudioUnlockGate(null, doc as unknown as Document);

    doc.dispatchEvent(new Event('pointerlockchange'));
    expect(gate.unlocked).toBe(false);

    doc.pointerLockElement = {} as Element;
    doc.dispatchEvent(new Event('pointerlockchange'));
    expect(gate.unlocked).toBe(true);
  });

  it('runs late subscribers immediately and supports unsubscribe', () => {
    gate = createAudioUnlockGate(null, null);
    const early = vi.fn();
    const off = gate.onUnlock(early);
    off();
    gate.unlock();
    expect(early).not.toHaveBeenCalled();

    const late = vi.fn();
    gate.onUnlock(late);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('a throwing listener does not starve the others', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    gate = createAudioUnlockGate(null, null);
    const ok = vi.fn();
    gate.onUnlock(() => {
      throw new Error('boom');
    });
    gate.onUnlock(ok);
    gate.unlock();
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
