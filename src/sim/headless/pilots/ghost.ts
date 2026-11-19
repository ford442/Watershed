/**
 * ghost.ts — a recorded run as a pilot (#556 C).
 *
 * A `.wsghost` is a recorded input track: `replayPlanFromFile(file).script` is what the page's
 * `?replay=` plays. As a pilot it is `scriptedHeadlessInput(script)` unchanged — it reads nothing
 * from the run — so the campaign pin (headless.campaign.test.ts) is reproduced through the same
 * `runUntil` every other pilot uses. The plan carries what the run must be created with (map,
 * launch hour, seed, conditions): the ghost only replays on the day it was recorded on.
 */
import { replayPlanFromFile, type ReplayPlan } from '../../../input/replay';
import type { WsGhostFile } from '../../../systems/ghost/ghostExport';
import { scriptedHeadlessInput, type HeadlessInput } from '../stepHeadless';

export interface GhostPilot {
  /** `createHeadlessRun` options the ghost was recorded under. */
  readonly plan: ReplayPlan;
  readonly input: HeadlessInput;
}

/** The ghost's pilot, or null when the file cannot be replayed (unknown map, no samples). */
export function ghostPilot(file: WsGhostFile): GhostPilot | null {
  const plan = replayPlanFromFile(file);
  if (!plan) return null;
  return { plan, input: scriptedHeadlessInput(plan.script) };
}
