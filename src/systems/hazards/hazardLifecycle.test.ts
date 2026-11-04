import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../sim/core/SimCore';
import type { HydroEvent } from '../water/hydroEvents';
import {
  createHazardRuntime,
  isHazardLiveAtHour,
  resetHazardRuntime,
  stepHazard,
  type HazardStepEvent,
  type HazardStepInput,
} from './hazardLifecycle';
import { parseHazards } from './parseHazards';
import { HAZARD_MIN_TELEGRAPH_SECONDS, type HazardConfig } from './hazardTypes';

function hazard(over: Partial<HazardConfig> = {}): HazardConfig {
  return parseHazards([
    {
      id: 'h',
      kind: 'damRelease',
      segmentIndex: 2,
      armDistance: 100,
      radius: 6,
      trigger: { type: 'proximity', distance: 40 },
      telegraphSeconds: 2,
      activeSeconds: 3,
      ...over,
    },
  ])[0];
}

const at = (distance: number | null, stage: number | null = null, live = true): HazardStepInput => ({
  live,
  distance,
  stage,
});

/** Step until something happens (or `max` steps); returns the event and how many steps it took. */
function stepUntilEvent(rt: ReturnType<typeof createHazardRuntime>, input: HazardStepInput, max = 10_000) {
  for (let i = 1; i <= max; i += 1) {
    const event = stepHazard(rt, input, SIM_DT);
    if (event !== null) return { event, steps: i };
  }
  return { event: null as HazardStepEvent, steps: max };
}

describe('hazard lifecycle (#522 A)', () => {
  it('runs dormant → armed → telegraph → active → spent, hitting the player once', () => {
    const rt = createHazardRuntime(hazard());
    expect(rt.phase).toBe('dormant');

    expect(stepHazard(rt, at(500), SIM_DT)).toBeNull(); // too far to arm
    expect(stepHazard(rt, at(90), SIM_DT)).toBe('armed');
    expect(stepHazard(rt, at(60), SIM_DT)).toBeNull(); // armed, outside the trigger
    expect(stepHazard(rt, at(30), SIM_DT)).toBe('telegraph');

    // The warning lasts exactly its authored 2 s on the fixed clock: 120 steps.
    const warn = stepUntilEvent(rt, at(3));
    expect(warn).toEqual({ event: 'active', steps: 120 });

    // Reaches the player from the next step, once per activation.
    expect(stepHazard(rt, at(3), SIM_DT)).toBe('hit');
    expect(rt.hit).toBe(true);
    const end = stepUntilEvent(rt, at(3));
    expect(end).toEqual({ event: 'spent', steps: 179 });
    expect(stepHazard(rt, at(0), SIM_DT)).toBeNull();
    expect(rt.phase).toBe('spent');
  });

  it('never warns for less than the minimum, whatever the config says', () => {
    const config = { ...hazard(), telegraphSeconds: 0.2 };
    const rt = createHazardRuntime(config);
    stepHazard(rt, at(10), SIM_DT);
    expect(stepHazard(rt, at(10), SIM_DT)).toBe('telegraph');
    const warn = stepUntilEvent(rt, at(10));
    expect(warn.event).toBe('active');
    expect(warn.steps * SIM_DT).toBeGreaterThanOrEqual(HAZARD_MIN_TELEGRAPH_SECONDS - 1e-9);
    expect(warn.steps).toBe(90);
  });

  it('stays dormant when not live at the launch hour, however close the player is', () => {
    const rt = createHazardRuntime(hazard());
    for (let i = 0; i < 600; i += 1) expect(stepHazard(rt, at(0, null, false), SIM_DT)).toBeNull();
    expect(rt.phase).toBe('dormant');
  });

  it('a hazard out of reach of the player never hits but still runs its course', () => {
    const rt = createHazardRuntime(hazard());
    stepHazard(rt, at(50), SIM_DT);
    stepHazard(rt, at(20), SIM_DT);
    expect(stepUntilEvent(rt, at(20)).event).toBe('active');
    expect(stepUntilEvent(rt, at(20)).event).toBe('spent');
  });

  it('a stage trigger reads the SWE stage, and falls back to proximity with no field', () => {
    const stage = hazard({ trigger: { type: 'stage', above: 0.4, distance: 25 } });
    const wet = createHazardRuntime(stage);
    stepHazard(wet, at(80), SIM_DT);
    expect(stepHazard(wet, at(10, 0.1), SIM_DT)).toBeNull(); // close, water still low
    expect(stepHazard(wet, at(30, 0.5), SIM_DT)).toBeNull(); // high water, player too far
    expect(stepHazard(wet, at(20, 0.5), SIM_DT)).toBe('telegraph');

    const dry = createHazardRuntime(stage);
    stepHazard(dry, at(80), SIM_DT);
    expect(stepHazard(dry, at(30, null), SIM_DT)).toBeNull();
    expect(stepHazard(dry, at(20, null), SIM_DT)).toBe('telegraph');

    // Ungated: the stage alone fires it; with no field it never does.
    const ungated = hazard({ trigger: { type: 'stage', above: 0.4 } });
    const a = createHazardRuntime(ungated);
    stepHazard(a, at(80), SIM_DT);
    expect(stepHazard(a, at(80, 0.45), SIM_DT)).toBe('telegraph');
    const b = createHazardRuntime(ungated);
    stepHazard(b, at(80), SIM_DT);
    for (let i = 0; i < 300; i += 1) expect(stepHazard(b, at(5, null), SIM_DT)).toBeNull();
  });

  it('a delay trigger fires its seconds after arming, wherever the player is', () => {
    const rt = createHazardRuntime(hazard({ trigger: { type: 'delay', seconds: 1 } }));
    stepHazard(rt, at(90), SIM_DT);
    expect(stepUntilEvent(rt, at(null))).toEqual({ event: 'telegraph', steps: 60 });
  });

  it('reset puts a spent hazard back to the top of the run', () => {
    const rt = createHazardRuntime(hazard({ trigger: { type: 'delay', seconds: 0 } }));
    stepHazard(rt, at(3), SIM_DT);
    expect(stepUntilEvent(rt, at(3)).event).toBe('telegraph');
    expect(stepUntilEvent(rt, at(3)).event).toBe('active');
    expect(stepUntilEvent(rt, at(3)).event).toBe('hit');
    expect(stepUntilEvent(rt, at(3)).event).toBe('spent');
    resetHazardRuntime(rt);
    expect(rt).toMatchObject({ phase: 'dormant', phaseTime: 0, hit: false });
  });
});

describe('isHazardLiveAtHour', () => {
  const surge: HydroEvent = { id: 'dam-surge', kind: 'surge', segmentIndex: 4, hours: [14, 15] };

  it('always, with neither hours nor a hydro event', () => {
    expect(isHazardLiveAtHour(hazard(), 3, [])).toBe(true);
  });

  it('at its own hours only', () => {
    const config = hazard({ hours: [6] });
    expect(isHazardLiveAtHour(config, 6, [])).toBe(true);
    expect(isHazardLiveAtHour(config, 30, [])).toBe(true); // wraps like hydro hours
    expect(isHazardLiveAtHour(config, 7, [])).toBe(false);
  });

  it('exactly when the hydro event it follows is live', () => {
    const config = hazard({ hydroEventId: 'dam-surge' });
    expect(isHazardLiveAtHour(config, 14, [surge])).toBe(true);
    expect(isHazardLiveAtHour(config, 9, [surge])).toBe(false);
    expect(isHazardLiveAtHour(config, 14, [])).toBe(false); // a missing event is never live
    expect(isHazardLiveAtHour(hazard({ hydroEventId: 'dam-surge', hours: [15] }), 14, [surge])).toBe(false);
  });
});
