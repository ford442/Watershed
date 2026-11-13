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
 */
import type { SimContext } from '../../sim/core/SimCore';
import { gameEvents } from '../events/GameEvents';
import { shockRunSurvival, getRunMap } from '../journey/runSession';
import { getSegmentFrame, getSegmentFramesVersion, resolveSegmentAnchor } from '../map/segmentFrames';
import {
  createHazardRuntime,
  isHazardLiveAtHour,
  resetHazardRuntime,
  stepHazard,
  type HazardRuntime,
  type HazardStepInput,
} from './hazardLifecycle';
import { HAZARD_DEFAULT_TELEGRAPH_SECONDS, HAZARD_MIN_TELEGRAPH_SECONDS } from './hazardTypes';
import { parseHazards } from './parseHazards';
import { initHazardLogListener } from './hazardLog';

interface HazardSlot {
  rt: HazardRuntime;
  /** World anchor on the live segment frame; null while the segment is off the treadmill. */
  anchor: [number, number, number] | null;
}

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
  const input: HazardStepInput = { live: false, distance: null, stage: null };

  function syncSlots(): HazardSlot[] {
    const raw = getRunMap().levelData.hazards;
    if (raw !== source) {
      source = raw;
      slots = parseHazards(raw).map((config) => ({ rt: createHazardRuntime(config), anchor: null }));
      framesVersion = -1;
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

  return {
    step(ctx, dt) {
      if (syncSlots().length === 0) return;
      refreshAnchors();
      const v = ctx.vehicle;
      for (const slot of slots) {
        const { rt, anchor } = slot;
        if (rt.phase === 'spent') continue;
        const c = rt.config;
        input.live = isHazardLiveAtHour(c, ctx.water.launchHour, ctx.water.hydroEvents);
        input.distance = anchor && v.posOk ? Math.hypot(v.x - anchor[0], v.z - anchor[2]) : null;
        input.stage =
          anchor && rt.phase === 'armed' && c.trigger.type === 'stage' ? ctx.water.stageAt(anchor[0], anchor[2]) : null;

        const event = stepHazard(rt, input, dt);
        if (event === null) continue;
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
    },
    reset() {
      for (const slot of slots) resetHazardRuntime(slot.rt);
    },
  };
}
