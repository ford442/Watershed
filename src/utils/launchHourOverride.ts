/**
 * launchHourOverride — `?hour=14` for scouting and visual smoke (#398).
 *
 * The 06:00 vs 14:00 contrast is the product claim for authored `hydroEvents`,
 * so a harness has to be able to load the same map at both hours without
 * clicking through the StartMenu. Read-only: it never writes persistence, so a
 * smoke run cannot clobber the player's chosen launch hour.
 */

const HOUR_PARAM = 'hour';

/** Parse an hour override from a query string; null when absent or malformed. */
export function parseLaunchHourOverride(search?: string): number | null {
  const raw = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  if (!raw) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw.startsWith('?') ? raw : `?${raw}`);
  } catch {
    return null;
  }
  const value = params.get(HOUR_PARAM);
  if (value === null || value.trim() === '') return null;
  const hour = Number(value);
  if (!Number.isFinite(hour)) return null;
  const floored = Math.floor(hour);
  if (floored < 0 || floored > 23) return null;
  return floored;
}

/** Live override for this page load, or null. */
export function launchHourOverride(): number | null {
  return parseLaunchHourOverride();
}
