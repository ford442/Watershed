import { isDataUrlConnectAllowed, resetDataUrlConnectProbe } from './cspProbe';

describe('isDataUrlConnectAllowed', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    resetDataUrlConnectProbe();
    global.fetch = originalFetch;
  });

  it('returns true when data: fetch succeeds', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    await expect(isDataUrlConnectAllowed()).resolves.toBe(true);
  });

  it('returns false when data: fetch is blocked by CSP', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(isDataUrlConnectAllowed()).resolves.toBe(false);
  });

  it('memoizes the probe result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;
    await isDataUrlConnectAllowed();
    await isDataUrlConnectAllowed();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
