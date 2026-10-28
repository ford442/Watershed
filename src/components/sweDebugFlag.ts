/** True when the URL opts into the SWE bed overlay (`?sweDebug=1`). Lives apart from the
 *  overlay so reading the flag at boot does not pull the overlay into the entry chunk. */
import { currentSearch } from '../config/queryFlags';
export function isSWEDebugEnabled(search = currentSearch()): boolean {
  const raw = new URLSearchParams(search).get('sweDebug');
  return raw === '1' || raw === 'true';
}
