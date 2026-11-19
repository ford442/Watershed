import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HazardBanner, { headlineHazard } from './HazardBanner';
import { publishLiveHazards, resetHazardLive, type LiveHazard } from '../systems/hazards/hazardLive';
import { TELEGRAPH_GLYPH } from '../systems/settings/access';

function hazard(over: Partial<LiveHazard> = {}): LiveHazard {
  return {
    id: 'dam',
    kind: 'damRelease',
    segmentIndex: 4,
    phase: 'telegraph',
    secondsLeft: 5.2,
    anchor: [0, 0, -100],
    radius: 60,
    stage: 1,
    ...over,
  };
}

describe('headlineHazard (#578 A)', () => {
  it('picks the most urgent hazard and rounds its countdown up', () => {
    expect(headlineHazard([])).toBeNull();
    expect(headlineHazard([hazard({ phase: 'armed', secondsLeft: null })])).toEqual({
      kind: 'damRelease',
      phase: 'armed',
      seconds: 0,
    });
    const jam = hazard({ id: 'jam', kind: 'logJam', phase: 'active', secondsLeft: 2.01 });
    expect(headlineHazard([hazard(), jam])).toEqual({ kind: 'logJam', phase: 'active', seconds: 3 });
  });
});

describe('HazardBanner (#578 A)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetHazardLive();
  });
  afterEach(() => {
    resetHazardLive();
    vi.useRealTimers();
  });

  it('says the phase with a glyph and a word, not with colour alone, and follows the countdown', () => {
    const dam = hazard();
    publishLiveHazards([dam]);
    render(<HazardBanner />);
    const banner = screen.getByTestId('hazard-banner');
    expect(banner.dataset.phase).toBe('telegraph');
    expect(banner.textContent).toContain(TELEGRAPH_GLYPH.telegraph);
    expect(banner.textContent).toContain('Dam release in 6 s');

    dam.secondsLeft = 1.5;
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(banner.textContent).toContain('Dam release in 2 s');

    dam.phase = 'active';
    publishLiveHazards([dam]);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId('hazard-banner').dataset.phase).toBe('active');
    expect(screen.getByTestId('hazard-banner').textContent).toContain(TELEGRAPH_GLYPH.active);
    expect(screen.getByTestId('hazard-banner').textContent).toContain('Dam release — surge');
  });

  it('renders nothing once no hazard is up', () => {
    render(<HazardBanner />);
    expect(screen.queryByTestId('hazard-banner')).toBeNull();
  });
});
