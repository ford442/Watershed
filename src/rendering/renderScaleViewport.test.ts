import {
  renderScaleViewport,
  renderScaleViewportUnits,
  type RenderScaleViewportRect,
} from './renderScaleViewport';

describe('renderScaleViewport', () => {
  const out: RenderScaleViewportRect = { x: -1, y: -1, width: -1, height: -1 };

  it.each([0.5, 0.73, 0.9, 1])('rounds down odd target dimensions at scale %s', (scale) => {
    const rect = renderScaleViewport(1234, 567, scale, out, 'render-target-pixels');
    expect(rect).toBe(out);
    expect(rect).toEqual({
      x: 0,
      y: 0,
      width: Math.max(1, Math.floor(1234 * scale)),
      height: Math.max(1, Math.floor(567 * scale)),
    });
  });

  it('represents the same integer target rectangle in legacy logical units', () => {
    const pixelRatio = 1.5;
    const rect = renderScaleViewport(1234, 567, 0.73, out, 'legacy-webgl-logical', pixelRatio);
    expect(rect.x * pixelRatio).toBe(0);
    expect(rect.y * pixelRatio).toBe(0);
    expect(rect.width * pixelRatio).toBe(Math.floor(1234 * 0.73));
    expect(rect.height * pixelRatio).toBe(Math.floor(567 * 0.73));
  });

  it('keeps every viewport side at least one pixel', () => {
    expect(renderScaleViewport(0, 0, 0, out, 'render-target-pixels')).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it('selects units for legacy WebGL, newer WebGL, and WebGPU', () => {
    expect(renderScaleViewportUnits(185, false)).toBe('legacy-webgl-logical');
    expect(renderScaleViewportUnits(187, false)).toBe('render-target-pixels');
    expect(renderScaleViewportUnits(185, true)).toBe('render-target-pixels');
  });
});
