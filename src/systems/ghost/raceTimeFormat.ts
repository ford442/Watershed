/** raceTimeFormat.ts — `m:ss.cc` formatting shared by the results screen and split table. */

export function formatRaceTimeMs(ms: number): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalCentis = Math.round(safeMs / 10);
  const mins = Math.floor(totalCentis / 6000);
  const secs = Math.floor((totalCentis % 6000) / 100);
  const centis = totalCentis % 100;
  return `${mins}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}
