import { describe, expect, it } from 'vitest';
import { SWE_MEAN_DEPTH } from '../systems/water/SWEHeightField';
import { BATHYMETRY_DRY_BED } from '../systems/water/bathymetrySampler';
import { wetFraction } from '../systems/water/sweBedDebug';
import { bedColor, isSWEDebugEnabled } from './SWEBedDebugOverlay';

describe('isSWEDebugEnabled', () => {
  it('opts in only on an explicit flag', () => {
    expect(isSWEDebugEnabled('?sweDebug=1')).toBe(true);
    expect(isSWEDebugEnabled('?sweDebug=true')).toBe(true);
    expect(isSWEDebugEnabled('?sweDebug=0')).toBe(false);
    expect(isSWEDebugEnabled('')).toBe(false);
  });
});

describe('bedColor', () => {
  it('reads deep water as blue and dry bank as tan', () => {
    const [, , deepB] = bedColor(-SWE_MEAN_DEPTH);
    const [dryR, , dryB] = bedColor(BATHYMETRY_DRY_BED);
    expect(deepB).toBeGreaterThan(200);
    expect(dryR).toBeGreaterThan(dryB);
  });

  it('separates shallow from deep', () => {
    const shallow = bedColor(SWE_MEAN_DEPTH * 0.8);
    const deep = bedColor(0);
    expect(shallow[1]).toBeGreaterThan(deep[1]);
  });
});

describe('wetFraction', () => {
  it('counts cells holding water at rest', () => {
    const bed = Float32Array.from([0, 0, BATHYMETRY_DRY_BED, BATHYMETRY_DRY_BED]);
    expect(
      wetFraction({
        bed,
        width: 2,
        height: 2,
        cellSize: 0.5,
        originX: 0,
        originZ: 0,
        coveredCells: 4,
        sourceCount: 1,
      })
    ).toBeCloseTo(0.5, 6);
  });
});
