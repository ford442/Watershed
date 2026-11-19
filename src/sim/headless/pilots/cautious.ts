/**
 * cautious.ts — the centreline pilot that heeds a hazard's telegraph (#578 A.4).
 *
 * The same pursuit as `centreline.ts`, with one rule on top, the one a careful
 * player follows: when a hazard is telegraphing or active and the body is
 * within `margin` metres of its reach (`radius`), stop — no forward push, no
 * sprint — and back off if already inside the margin's inner half. Once the
 * hazard is spent the pilot carries on down the centreline.
 *
 * It reads what the HUD shows the player (`hazardLive`: the phase, the anchor,
 * the reach), nothing a player could not see. The pair "this pilot survives,
 * the plain centreline pilot does not" is the dam release's acceptance; until a
 * pilots issue ships a policy library, the pair is this wrapper and the plain
 * pilot.
 *
 * Headless only: never imported by app code (scripts/check-dependency-direction.mjs).
 */
import { getLiveHazards } from '../../../systems/hazards/hazardLive';
import { centrelinePolicy, type CentrelineOptions } from './centreline';
import { createPilot, type Pilot, type PilotPolicy } from './pilot';
import type { HeadlessRun } from '../createHeadlessRun';

export interface CautiousOptions extends CentrelineOptions {
  /** Metres beyond a hazard's reach to hold at (default 14). */
  margin?: number;
}

/** The telegraphing or active hazard whose reach (plus `margin`) covers (x, z), as distance and reach; null for none. */
function heldBy(x: number, z: number, margin: number): { distance: number; reach: number } | null {
  for (const hazard of getLiveHazards()) {
    if (hazard.phase === 'armed' || !hazard.anchor) continue;
    const distance = Math.hypot(x - hazard.anchor[0], z - hazard.anchor[2]);
    const reach = hazard.radius + margin;
    if (distance < reach) return { distance, reach };
  }
  return null;
}

/** The centreline policy, holding short of any telegraphing or active hazard. */
export function cautiousPolicy(options: CautiousOptions = {}): PilotPolicy {
  const margin = options.margin ?? 14;
  const pursue = centrelinePolicy(options);
  return (view, out) => {
    pursue(view, out);
    const held = heldBy(view.x, view.z, margin);
    if (!held) return;
    // Hold: keep facing downstream (the pursuit's yaw), drop the push and the
    // sprint, and step back while inside the inner half of the margin.
    out.moveY = held.distance < held.reach - margin * 0.5 ? -1 : 0;
    out.moveX = 0;
    out.buttons = 0;
  };
}

/** A cautious pilot over `run`. */
export function cautiousPilot(run: HeadlessRun, options: CautiousOptions = {}): Pilot {
  return createPilot(run, 'cautious', cautiousPolicy(options));
}
