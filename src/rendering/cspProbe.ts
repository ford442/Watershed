/**
 * Detect whether fetch() to data: URLs is permitted by the page CSP.
 * Three.js WebGPURenderer loads bundled WGSL via data:text/wgsl;base64,...
 * which requires `data:` in connect-src on strict hosts.
 */
let cachedDataUrlConnectAllowed: boolean | null = null;

export async function isDataUrlConnectAllowed(): Promise<boolean> {
  if (cachedDataUrlConnectAllowed !== null) {
    return cachedDataUrlConnectAllowed;
  }

  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    cachedDataUrlConnectAllowed = false;
    return false;
  }

  try {
    const response = await fetch('data:text/plain;base64,dGVzdA==');
    cachedDataUrlConnectAllowed = response.ok;
  } catch {
    cachedDataUrlConnectAllowed = false;
  }

  return cachedDataUrlConnectAllowed;
}

/** Test helper — reset memoized probe result. */
export function resetDataUrlConnectProbe(): void {
  cachedDataUrlConnectAllowed = null;
}
