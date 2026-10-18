/** True when the URL opts into the SWE bed overlay (`?sweDebug=1`). Lives apart from the
 *  overlay so reading the flag at boot does not pull the overlay into the entry chunk. */
export function isSWEDebugEnabled(search = typeof window === 'undefined' ? '' : window.location.search): boolean {
  const raw = new URLSearchParams(search).get('sweDebug');
  return raw === '1' || raw === 'true';
}
