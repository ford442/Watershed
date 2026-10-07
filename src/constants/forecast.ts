/**
 * The default launch day's forecast inputs — a leaf module (no map registry,
 * no React) so the sim worker's river router reads the same day (#455).
 * Re-exported from experience/constants.ts.
 */

export const DAM_RELEASE_SCHEDULE = [
  { hour: 6, release: 0.08 },
  // Peak release pushes melt+release over WashedOut so Hydro-Dam catwalks
  // open a gap; hour-6 Flooded keeps the portage ledge.
  { hour: 14, release: 0.35 },
] as const satisfies ReadonlyArray<{ hour: number; release: number }>;

/**
 * Weather inputs of the default launch forecast. The launch-hour picker, the
 * treadmill's per-segment forecast and the river routing (riverRouter.ts) all
 * read the same day, so scouting an hour shows the water the run will get.
 */
export const DEFAULT_FORECAST_INPUTS = {
  temperature: 8,
  snowpackIndex: 0.65,
  damReleaseSchedule: DAM_RELEASE_SCHEDULE,
} as const;
