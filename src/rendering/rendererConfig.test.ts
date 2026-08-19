import { isSoftwareRendererAllowed, isVisualCaptureMode } from './rendererConfig';

describe('isVisualCaptureMode', () => {
  it('returns true only for screenshot or capture query params', () => {
    expect(isVisualCaptureMode('?screenshot=1')).toBe(true);
    expect(isVisualCaptureMode('?capture=1')).toBe(true);
    expect(isVisualCaptureMode('?screenshot=1&map=glacial')).toBe(true);
    expect(isVisualCaptureMode('')).toBe(false);
    expect(isVisualCaptureMode('?screenshot=0')).toBe(false);
  });
});

describe('isSoftwareRendererAllowed', () => {
  it('opts out of failIfMajorPerformanceCaveat for the capture harness', () => {
    expect(isSoftwareRendererAllowed('?screenshot=1')).toBe(true);
    expect(isSoftwareRendererAllowed('?capture=1')).toBe(true);
  });

  it('opts out for an explicit headless/CI run that is not capturing', () => {
    expect(isSoftwareRendererAllowed('?softwareGl=1')).toBe(true);
    expect(isSoftwareRendererAllowed('?softwareGl=1&map=glacial')).toBe(true);
  });

  it('stays off for a normal player session', () => {
    expect(isSoftwareRendererAllowed('')).toBe(false);
    expect(isSoftwareRendererAllowed('?quality=ultra')).toBe(false);
    expect(isSoftwareRendererAllowed('?softwareGl=0')).toBe(false);
  });
});
