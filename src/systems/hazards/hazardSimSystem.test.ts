import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimCore, SIM_DT } from '../../sim/core/SimCore';
import { gameEvents, type HazardPhaseDetail } from '../events/GameEvents';
import { buildSegmentFrame, clearSegmentFrames, publishSegmentFrames } from '../map/segmentFrames';
import { createHazardSimSystem, HAZARD_SIM_ORDER, isHazardRuntimeSettled, loadHazardRuntime } from './hazardSimSystem';

const run = vi.hoisted(() => ({
  levelData: { hazards: [] as unknown[] },
  shock: vi.fn(),
}));

vi.mock('../journey/runSession', () => ({
  getRunMap: () => ({ levelData: run.levelData }),
  shockRunSurvival: run.shock,
}));

/** Segment 2: a straight reach from z = −100 to −200; the anchor (t = 0.5) sits at z = −150. */
function publishReach(): void {
  publishSegmentFrames([
    buildSegmentFrame(2, { getPoint: (t) => ({ x: 0, y: -10, z: -100 - 100 * t }) }),
  ]);
}

const DAM = {
  id: 'dam-release',
  kind: 'damRelease',
  segmentIndex: 2,
  armDistance: 100,
  radius: 6,
  trigger: { type: 'proximity', distance: 40 },
  telegraphSeconds: 2,
  activeSeconds: 3,
  consequence: { wetness: 0.3 },
};

interface Logged {
  step: number;
  what: string;
}

/** A runner heading downstream at 10 m/s from z = 0, `seconds` of sim; what the hazards did, by step. */
function runDownstream(core: SimCore, seconds: number, opts: { pauseFrom?: number; pauseTo?: number } = {}): Logged[] {
  const log: Logged[] = [];
  const offPhase = gameEvents.on('hazard-phase', (d) => log.push({ step: core.ctx.stepIndex, what: `${d.hazardId}:${d.phase}` }));
  const offHit = gameEvents.on('hazard-hit', (d) => log.push({ step: core.ctx.stepIndex, what: `${d.hazardId}:hit` }));
  core.reset();
  const v = core.ctx.vehicle;
  v.valid = true;
  v.posOk = true;
  let z = 0;
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i += 1) {
    const paused = opts.pauseFrom !== undefined && i >= opts.pauseFrom && i < (opts.pauseTo ?? Infinity);
    core.ctx.paused = paused;
    if (!paused) z -= 10 * SIM_DT;
    v.x = 0;
    v.y = -9;
    v.z = z;
    core.step();
  }
  offPhase();
  offHit();
  return log;
}

describe('hazards sim system (#522 A)', () => {
  let core: SimCore;

  beforeAll(async () => {
    await loadHazardRuntime();
  });

  beforeEach(() => {
    core = new SimCore();
    core.register(createHazardSimSystem());
    run.levelData = { hazards: [DAM] };
    run.shock.mockClear();
    publishReach();
  });

  afterEach(() => {
    clearSegmentFrames();
    gameEvents.clear();
  });

  it('sits in the hazards band, after survival and before pillars', () => {
    expect(HAZARD_SIM_ORDER).toBeGreaterThan(40);
    expect(HAZARD_SIM_ORDER).toBeLessThan(50);
  });

  it('arms, telegraphs ≥ 1.5 s, reaches the player once and is spent', () => {
    const log = runDownstream(core, 20);
    expect(log.map((l) => l.what)).toEqual([
      'dam-release:armed',
      'dam-release:telegraph',
      'dam-release:active',
      'dam-release:hit',
      'dam-release:spent',
    ]);
    const stepOf = (what: string) => log.find((l) => l.what === `dam-release:${what}`)!.step;
    // Arms 100 m out (z = −50, 5 s), fires 40 m out (z = −110, 11 s).
    expect(stepOf('armed') * SIM_DT).toBeCloseTo(5, 1);
    expect(stepOf('telegraph') * SIM_DT).toBeCloseTo(11, 1);
    // The warning is the authored 2 s, never under the 1.5 s floor.
    expect((stepOf('active') - stepOf('telegraph')) * SIM_DT).toBeCloseTo(2, 6);
    // Reached within 6 m of the anchor (z ≥ −144), inside the 3 s it is dangerous.
    expect(stepOf('hit') * SIM_DT).toBeCloseTo(14.4, 1);
    expect((stepOf('spent') - stepOf('active')) * SIM_DT).toBeCloseTo(3, 6);
    // The consequence lands on the survival layer, once.
    expect(run.shock).toHaveBeenCalledTimes(1);
    expect(run.shock).toHaveBeenCalledWith({ wetness: 0.3, chill: 0 });
  });

  it('two runs on one core reach every transition on the same step', () => {
    const first = runDownstream(core, 20);
    const second = runDownstream(core, 20);
    expect(second).toEqual(first);
  });

  it('a paused step does not advance the warning', () => {
    const plain = runDownstream(core, 20);
    const telegraphStep = plain.find((l) => l.what.endsWith(':telegraph'))!.step;
    const paused = runDownstream(core, 22, { pauseFrom: telegraphStep + 10, pauseTo: telegraphStep + 70 });
    const step = (log: Logged[], what: string) => log.find((l) => l.what.endsWith(`:${what}`))!.step;
    expect(step(paused, 'telegraph')).toBe(telegraphStep);
    expect(step(paused, 'active') - step(plain, 'active')).toBe(60);
  });

  it('cannot arm while its segment is off the treadmill', () => {
    clearSegmentFrames();
    expect(runDownstream(core, 20)).toEqual([]);
  });

  it('stays dormant at a launch hour it is not live', () => {
    run.levelData = { hazards: [{ ...DAM, hours: [14] }] };
    core.ctx.water.launchHour = 6;
    expect(runDownstream(core, 20)).toEqual([]);
    core.ctx.water.launchHour = 14;
    expect(runDownstream(core, 20).length).toBe(5);
  });

  it('follows its hydro event through ctx.water', () => {
    run.levelData = { hazards: [{ ...DAM, hydroEventId: 'dam-surge' }] };
    core.ctx.water.hydroEvents = [{ id: 'dam-surge', kind: 'surge', segmentIndex: 2, hours: [14] }];
    core.ctx.water.launchHour = 9;
    expect(runDownstream(core, 20)).toEqual([]);
    core.ctx.water.launchHour = 14;
    expect(runDownstream(core, 20).map((l) => l.what)[0]).toBe('dam-release:armed');
  });

  it('a stage trigger reads ctx.water.stageAt at the anchor', () => {
    run.levelData = { hazards: [{ ...DAM, trigger: { type: 'stage', above: 0.5 } }] };
    const reads: Array<[number, number]> = [];
    let stage = 0;
    core.ctx.water.stageAt = (x, z) => {
      reads.push([x, z]);
      return stage;
    };
    // Still water: it arms on approach and waits there.
    expect(runDownstream(core, 20).map((l) => l.what)).toEqual(['dam-release:armed']);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads[0][0]).toBeCloseTo(0, 6);
    expect(reads[0][1]).toBeCloseTo(-150, 6);
    stage = 0.8;
    const log = runDownstream(core, 20);
    expect(log.map((l) => l.what).slice(0, 2)).toEqual(['dam-release:armed', 'dam-release:telegraph']);
    expect(log[1].step).toBe(log[0].step + 1);
  });

  it('emits the anchor in world space with each phase', () => {
    const phases: HazardPhaseDetail[] = [];
    gameEvents.on('hazard-phase', (d) => phases.push(d));
    runDownstream(core, 20);
    expect(phases[0]).toMatchObject({ hazardId: 'dam-release', kind: 'damRelease', segmentIndex: 2, phase: 'armed' });
    expect(phases[0].anchor!.z).toBeCloseTo(-150, 6);
  });

  it('a map with no hazards costs one lookup and does nothing', () => {
    run.levelData = { hazards: [] };
    expect(runDownstream(core, 5)).toEqual([]);
    expect(run.shock).not.toHaveBeenCalled();
    expect(isHazardRuntimeSettled()).toBe(true);
  });

  it('is settled for the harness once the runtime has loaded', () => {
    expect(isHazardRuntimeSettled()).toBe(true);
  });
});
