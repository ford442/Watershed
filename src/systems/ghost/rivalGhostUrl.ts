/**
 * rivalGhostUrl.ts — optional `?ghost=<same-origin-url>` rival import.
 *
 * No backend: this fetches a same-origin JSON file (e.g. one a player hosts
 * next to a shared replay) and imports it exactly like a dropped `.wsghost`
 * file. A missing file, a cross-origin URL, or an invalid payload is ignored
 * — this is a nice-to-have, never a hard dependency for booting the game.
 */

import { importGhostFromJson } from './ghostExport';
import { setRivalGhost } from '../persistence/PersistenceSystem';

/** Reads `?ghost=` from the URL; same-origin only (rejects absolute cross-origin URLs). */
function parseSameOriginGhostUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('ghost');
  if (!raw) return null;

  try {
    const resolved = new URL(raw, window.location.origin);
    if (resolved.origin !== window.location.origin) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

/**
 * Fetch `?ghost=` (if present) and store it as the rival for `activeMapId`.
 * Fire-and-forget: never throws, never blocks boot.
 */
export async function loadRivalGhostFromUrl(activeMapId: string): Promise<void> {
  const url = parseSameOriginGhostUrl();
  if (!url) return;

  try {
    const response = await fetch(url);
    if (!response.ok) return;
    const json = await response.text();
    const result = importGhostFromJson(json, activeMapId);
    if (result.ok) {
      setRivalGhost(activeMapId, result.file);
    }
  } catch {
    // Offline, 404, malformed JSON — silently ignore; this is opt-in sharing.
  }
}
