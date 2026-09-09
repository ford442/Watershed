/**
 * hydroHud — the launch-hour contrast, in words (#397).
 *
 * Pure: takes authored events + the run's launch hour, returns rows the HUD
 * renders. The point is that a player scouting 06:00 against 14:00 can read
 * *what changes* before committing to a run, and can see mid-run which
 * authored event is live on the segment they are in.
 */

import { eventsActiveAtHour, normalizeHour, type HydroEvent, type HydroEventKind } from './hydroEvents';

/** The hour a player scouts against — the dam's quiet morning. */
export const HYDRO_CONTROL_HOUR = 6;
/** The hour the dam releases. Matches DAM_RELEASE_SCHEDULE's peak entry. */
export const HYDRO_RELEASE_HOUR = 14;

const KIND_LABELS: Record<HydroEventKind, string> = {
  inflowPulse: 'Dam pulse',
  vortex: 'Drain vortex',
  braid: 'Gravel braid',
  roughness: 'Slack water',
};

/** What each kind does to the river, one clause, for the HUD subtitle. */
const KIND_EFFECTS: Record<HydroEventKind, string> = {
  inflowPulse: 'stage up, rides faster',
  vortex: 'swirl pulls to the drain',
  braid: 'channel splits, pushes wide',
  roughness: 'current damped, slow line',
};

export interface HydroHudRow {
  id: string;
  segmentIndex: number;
  kind: HydroEventKind;
  label: string;
  effect: string;
  /** Live at the run's launch hour. */
  live: boolean;
  /** The player is inside this event's segment right now. */
  here: boolean;
}

export interface HydroHudBoard {
  launchHour: number;
  /** The hour the board contrasts against (the *other* scouting hour). */
  contrastHour: number;
  rows: HydroHudRow[];
  /** One line: what the other hour would have changed. */
  contrastLine: string | null;
}

export function labelHydroKind(kind: HydroEventKind): string {
  return KIND_LABELS[kind];
}

/**
 * Build the HUD board for `launchHour`, contrasted against the other of the
 * two authored scouting hours (06:00 / 14:00).
 */
export function buildHydroHudBoard(
  events: readonly HydroEvent[] | undefined,
  launchHour: number,
  currentSegmentIndex = -1,
): HydroHudBoard {
  const hour = normalizeHour(launchHour);
  const contrastHour = hour === HYDRO_RELEASE_HOUR ? HYDRO_CONTROL_HOUR : HYDRO_RELEASE_HOUR;
  const live = eventsActiveAtHour(events, hour);
  const other = eventsActiveAtHour(events, contrastHour);

  const rows: HydroHudRow[] = live.map((event) => ({
    id: event.id,
    segmentIndex: event.segmentIndex,
    kind: event.kind,
    label: KIND_LABELS[event.kind],
    effect: KIND_EFFECTS[event.kind],
    live: true,
    here: event.segmentIndex === currentSegmentIndex,
  }));
  rows.sort((a, b) => a.segmentIndex - b.segmentIndex);

  const liveIds = new Set(live.map((event) => event.id));
  const gained = other.filter((event) => !liveIds.has(event.id));
  const contrastLine =
    gained.length > 0
      ? `H${String(contrastHour).padStart(2, '0')}:00 instead: ${gained
          .map((event) => `${KIND_LABELS[event.kind]} @ seg ${event.segmentIndex}`)
          .join(' · ')}`
      : null;

  return { launchHour: hour, contrastHour, rows, contrastLine };
}
