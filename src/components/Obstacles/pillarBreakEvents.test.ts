import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { emitPillarBreak, PILLAR_BREAK_EVENT } from './pillarBreakEvents';

describe('pillarBreakEvents', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatches a pillarBreak CustomEvent with detail', () => {
    const detail = {
      segmentIndex: 22,
      pillarIndex: 1,
      impactPoint: { x: 0, y: 1, z: -2 },
      impactSpeed: 14,
      fragmentCount: 8,
    };

    emitPillarBreak(detail);

    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    const event = vi.mocked(window.dispatchEvent).mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe(PILLAR_BREAK_EVENT);
    expect(event.detail).toEqual(detail);
  });
});
