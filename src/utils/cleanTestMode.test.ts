import { isCleanTestMode, setCleanTestMode } from './cleanTestMode';

describe('cleanTestMode', () => {
  const originalHref = window.location.href;

  afterEach(() => {
    window.history.replaceState({}, '', originalHref);
  });

  it('detects cleanTest URL param', () => {
    expect(isCleanTestMode('?cleanTest=1')).toBe(true);
    expect(isCleanTestMode('?clean-test=true')).toBe(true);
    expect(isCleanTestMode('?debug=1')).toBe(false);
  });

  it('auto-enables for screenshot capture URLs', () => {
    expect(isCleanTestMode('?renderer=webgl&screenshot=1')).toBe(true);
    expect(isCleanTestMode('?capture=1')).toBe(true);
  });

  it('updates URL when toggled', () => {
    window.history.replaceState({}, '', '/');
    setCleanTestMode(true);
    expect(window.location.search).toContain('cleanTest=1');
    setCleanTestMode(false);
    expect(window.location.search).not.toContain('cleanTest');
  });
});
