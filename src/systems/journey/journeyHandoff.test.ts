/**
 * journeyHandoff.test.ts — map handoff kickoff.
 */

import { describe, expect, it } from 'vitest';
import { kickoffMapHandoff, resolveNextReachId } from './journeyHandoff';

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
  it('plans the hydro → delta handoff', () => {
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
  });
});
