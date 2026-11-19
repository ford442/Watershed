/**
 * hazardRuntime — the body of SimCore's `hazards` system (#522 A), in its own
 * chunk: only a run on a map that authors `hazards[]` fetches it
 * (hazardSimSystem.ts is the entry-side facade that loads and calls it).
 *
 * Each step, per hazard, it samples what the lifecycle reads — live at the
 * launch hour (`ctx.water`), the player's horizontal distance to the anchor
 * (the segment frame + `centerT` / `lateralOffset`), the SWE stage there
 * (`ctx.water.stageAt`) — and steps `hazardLifecycle`. A phase change is
 * emitted as `hazard-phase` (telegraph cues, the ghost's hazard log), a hit as
 * `hazard-hit` after its consequence lands on the survival layer.
 *
 * A hazard whose segment is not
 * on the treadmill has no anchor and so cannot arm (the treadmill holds the
 * segments around the player; nothing far away can reach them anyway).
 *
 * Each step also publishes what the rest of the page reads (hazardLive.ts,
 * #578 A): the discharge an active hazard's `release` adds — sweHost routes it
 * down the chain from the hazard's segment — and the armed / telegraphing /
 * active hazards with their sim-clock countdowns, for the telegraph renderer and
 * the HUD. At most one release runs at a time: the first active one in authored
 * order (registry.contract.test.ts keeps a shipped map from overlapping two).
 */
import type { SimContext } from '../../sim/core/SimCore';
import { gameEvents } from '../events/GameEvents';
import { shockRunSurvival, getRunMap } from '../journey/runSession';
import { getSegmentFrame, getSegmentFramesVersion, resolveSegmentAnchor } from '../map/segmentFrames';
import {
  createHazardRuntime,
  hazardPhaseSecondsLeft,
  hazardReleaseDischarge,
  resetHazardRuntime,
  stepHazard,
  type HazardRuntime,
  type HazardStepInput,
} from './hazardLifecycle';
import { isHazardLiveAtHour } from './hazardHours';
import {
  publishHazardRelease,
  publishLiveHazards,
  resetHazardLive,
  type LiveHazard,
  type LiveRelease,
} from './hazardLive';
import {
  HAZARD_DEFAULT_RADIUS,
  HAZARD_DEFAULT_TELEGRAPH_SECONDS,
  HAZARD_MIN_TELEGRAPH_SECONDS,
  HAZARD_RELEASE_REACH_FRACTION,
} from './hazardTypes';
import { parseHazards } from './parseHazards';
import { initHazardLogListener } from './hazardLog';

interface HazardSlot {
  rt: HazardRuntime;
  /** World anchor on the live segment frame; null while the segment is off the treadmill. */
  anchor: [number, number, number] | null;
  /** What the page reads of this hazard while it is up (hazardLive); one object for the run. */
  live: LiveHazard;
}

function liveOf(rt: HazardRuntime): LiveHazard {
  const c = rt.config;
  return {
    id: c.id,
    kind: c.kind,
    segmentIndex: c.segmentIndex,
    phase: 'armed',
    secondsLeft: null,
    anchor: null,
    radius: c.radius ?? HAZARD_DEFAULT_RADIUS,
    stage: c.release ? c.release.stage : null,
  };
}

const isUp = (rt: HazardRuntime): boolean =>
  rt.phase === 'armed' || rt.phase === 'telegraph' || rt.phase === 'active';

/** What the facade calls: one step, one run reset. */
export interface HazardStepper {
  step(ctx: SimContext, dt: number): void;
  reset(): void;
}

export function createHazardStepper(): HazardStepper {
  // The log has nothing to hear before a hazard can step, so it wires up here,
  // in this chunk, not at boot.
  initHazardLogListener();
  /** The authored list the slots were built from (re-parsed when the run's map changes). */
  let source: unknown = undefined;
  let slots: HazardSlot[] = [];
  let framesVersion = -1;
  const input: HazardStepInput = { live: false, distance: null, stage: null, reachable: true };
  const releaseScratch: LiveRelease = { segmentIndex: 0, discharge: 0 };

  function syncSlots(): HazardSlot[] {
    const raw = getRunMap().levelData.hazards;
    if (raw !== source) {
      source = raw;
      slots = parseHazards(raw).map((config) => {
        const rt = createHazardRuntime(config);
        return { rt, anchor: null, live: liveOf(rt) };
      });
      framesVersion = -1;
      resetHazardLive();
    }
    return slots;
  }

  function refreshAnchors(): void {
    const version = getSegmentFramesVersion();
    if (version === framesVersion) return;
    framesVersion = version;
    for (const slot of slots) {
      const c = slot.rt.config;
      const frame = getSegmentFrame(c.segmentIndex);
      slot.anchor = frame ? resolveSegmentAnchor(frame, { t: c.centerT ?? 0.5, lateral: c.lateralOffset ?? 0 }) : null;
    }
  }

  /** What the page reads after this step: the release, the countdowns, and (on a change) the list. */
  function publish(changed: boolean): void {
    let release: LiveRelease | null = null;
    for (const slot of slots) {
      const { rt, live } = slot;
      if (!isUp(rt)) continue;
      live.secondsLeft = hazardPhaseSecondsLeft(rt);
      if (live.anchor !== slot.anchor) {
        live.anchor = slot.anchor;
        changed = true;
      }
      if (release === null) {
        const discharge = hazardReleaseDischarge(rt);
        if (discharge > 0) {
          releaseScratch.segmentIndex = rt.config.segmentIndex;
          releaseScratch.discharge = discharge;
          release = releaseScratch;
        }
      }
    }
    publishHazardRelease(release);
    if (changed) publishLiveHazards(slots.filter((slot) => isUp(slot.rt)).map((slot) => slot.live));
  }

  return {
    step(ctx, dt) {
      if (syncSlots().length === 0) return;
      refreshAnchors();
      const v = ctx.vehicle;
      let changed = false;
      for (const slot of slots) {
        const { rt, anchor } = slot;
        if (rt.phase === 'spent') continue;
        const c = rt.config;
        input.live = isHazardLiveAtHour(c, ctx.water.launchHour, ctx.water.hydroEvents);
        input.distance = anchor && v.posOk ? Math.hypot(v.x - anchor[0], v.z - anchor[2]) : null;
        input.stage =
          anchor && rt.phase === 'armed' && c.trigger.type === 'stage' ? ctx.water.stageAt(anchor[0], anchor[2]) : null;
        // A release reaches the player once its water has: the stage under them
        // is up. No field there (Low quality, off the window): the radius decides.
        input.reachable = true;
        if (rt.phase === 'active' && c.release && v.posOk && input.distance !== null && input.distance <= (c.radius ?? HAZARD_DEFAULT_RADIUS)) {
          const here = ctx.water.stageAt(v.x, v.z);
          input.reachable = here === null || here >= c.release.stage * HAZARD_RELEASE_REACH_FRACTION;
        }

        const event = stepHazard(rt, input, dt);
        if (event === null) continue;
        if (event !== 'hit') {
          changed = true;
          if (isUp(rt)) slot.live.phase = rt.phase as LiveHazard['phase'];
        }
        if (event === 'hit') {
          const wetness = c.consequence?.wetness ?? 0;
          const chill = c.consequence?.chill ?? 0;
          if (wetness > 0 || chill > 0) shockRunSurvival({ wetness, chill });
          gameEvents.emit('hazard-hit', { hazardId: c.id, kind: c.kind, segmentIndex: c.segmentIndex, wetness, chill });
        } else {
          gameEvents.emit('hazard-phase', {
            hazardId: c.id,
            kind: c.kind,
            segmentIndex: c.segmentIndex,
            phase: event,
            anchor: anchor ? { x: anchor[0], y: anchor[1], z: anchor[2] } : null,
            ...(event === 'telegraph'
              ? {
                  warnSeconds: Math.max(
                    HAZARD_MIN_TELEGRAPH_SECONDS,
                    c.telegraphSeconds ?? HAZARD_DEFAULT_TELEGRAPH_SECONDS,
                  ),
                }
              : {}),
          });
        }
      }
      publish(changed);
    },
    reset() {
      for (const slot of slots) {
        resetHazardRuntime(slot.rt);
        slot.live.phase = 'armed';
        slot.live.secondsLeft = null;
      }
      resetHazardLive();
    },
  };
}
