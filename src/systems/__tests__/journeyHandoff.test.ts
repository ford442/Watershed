/**
 * journeyHandoff.test.ts — Event emission + map handoff kickoff.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JOURNEY_HANDOFF_EVENT,
  MAP_ENTER_EVENT,
  MAP_EXIT_EVENT,
  kickoffMapHandoff,
  resolveNextReachId,
} from '../journeyHandoff';

describe('resolveNextReachId', () => {
  it('prefers transition.nextReachId over fallback', () => {
    expect(resolveNextReachId({ nextReachId: 'delta-reach' }, 'other')).toBe('delta-reach');
  });

  it('falls back when transition omits nextReachId', () => {
    expect(resolveNextReachId({ type: 'waterfall' }, 'meander-reach')).toBe('meander-reach');
    expect(resolveNextReachId(null, null)).toBeNull();
  });
});

describe('kickoffMapHandoff', () => {
  const events: Array<{ type: string; detail: unknown }> = [];

  beforeEach(() => {
    events.length = 0;
    vi.stubGlobal(
      'window',
      Object.assign(window, {
        dispatchEvent: (ev: Event) => {
          const ce = ev as CustomEvent;
          events.push({ type: ce.type, detail: ce.detail });
          return true;
        },
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('emits exit / handoff / enter for hydro → delta', () => {
    const result = kickoffMapHandoff({
      fromMapId: 'hydro',
      toMapId: 'delta',
      segmentIndex: 15,
      lastWidth: 40,
      lastWaterWidth: 12,
    });

    expect(result).not.toBeNull();
    expect(result!.plan.toMapId).toBe('delta');
    expect(result!.biomeKickoff.mode).toBe('crossfade');
    expect(result!.biomeKickoff.biomeId).toBe('delta');

    const types = events.map((e) => e.type);
    expect(types).toContain(MAP_EXIT_EVENT);
    expect(types).toContain(JOURNEY_HANDOFF_EVENT);
    expect(types).toContain(MAP_ENTER_EVENT);

    const handoff = events.find((e) => e.type === JOURNEY_HANDOFF_EVENT)?.detail as {
      seamless: boolean;
      fromId: string;
      toId: string;
    };
    expect(handoff.seamless).toBe(true);
    expect(handoff.fromId).toBe('hydro');
    expect(handoff.toId).toBe('delta');
  });
});
