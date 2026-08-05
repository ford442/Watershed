import { isVisualCaptureMode } from './rendererConfig';

describe('isVisualCaptureMode', () => {
  it('returns true only for screenshot or capture query params', () => {
    expect(isVisualCaptureMode('?screenshot=1')).toBe(true);
    expect(isVisualCaptureMode('?capture=1')).toBe(true);
    expect(isVisualCaptureMode('?screenshot=1&map=glacial')).toBe(true);
    expect(isVisualCaptureMode('')).toBe(false);
    expect(isVisualCaptureMode('?screenshot=0')).toBe(false);
  });
});
