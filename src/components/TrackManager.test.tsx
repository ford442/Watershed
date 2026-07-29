/**
 * TrackManager TypeScript surface test
 *
 * Verifies that the converted TrackManager.tsx component exports the expected
 * props/ref interface and can be imported without TypeScript errors. The actual
 * rendering requires an R3F Canvas context and is covered by the build / manual
 * smoke tests.
 */

import type { TrackManagerProps, TrackManagerRef } from './TrackManager';

describe('TrackManager.tsx surface', () => {
  it('exports typed props and ref interfaces that compile', () => {
    // Type-only checks: if these lines compile, the interface shape is correct.
    const props: TrackManagerProps = {
      startIndex: -3,
      forecastSamples: [{ state: 'Normal' }],
    };
    expect(props.startIndex).toBe(-3);

    const ref: TrackManagerRef = {
      synthesizeSegmentEnter: (index: number) => index,
      isInitialized: () => true,
      getLastEnteredSegment: () => 0,
    };
    expect(ref.isInitialized()).toBe(true);
  });
});
