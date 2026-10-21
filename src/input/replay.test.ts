import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { encodeGhostSamples, encodeGhostToBase64, decodeGhostFromBase64, type GhostSample } from '../systems/ghost/ghostCodec';
import { exportGhostToJson, importGhostFromJson } from '../systems/ghost/ghostExport';
import { constantWeatherScript, normalizeWeatherScript } from '../systems/weather/weatherScript';
import { createInputFrame, InputButton, INPUT_FIXED_DT_MS } from './InputFrame';
import { InputHub } from './InputHub';
import { parseInputScript, ScriptedSource } from './sources/ScriptedSource';
import { ghostToInputScript, replayPlanFromFile } from './replay';
import { getReplayGhostUrl, isScriptedInputMode } from './scriptedRun';

const WINDOW_MS = 6 * INPUT_FIXED_DT_MS;

function sample(i: number, yaw: number, input: Partial<ReturnType<typeof createInputFrame>>): GhostSample {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, yaw, 0, 'YXZ'));
  return {
    px: 0, py: 0, pz: -i, qx: q.x, qy: q.y, qz: q.z, qw: q.w,
    input: { ...createInputFrame(), dtMs: WINDOW_MS, ...input },
  };
}

function ghostPayload(samples: GhostSample[]): string {
  return encodeGhostToBase64(encodeGhostSamples(samples));
}

describe('ghostToInputScript', () => {
  it('turns each 10 Hz window into one keyframe six sim frames long, with the recorded look', () => {
    const payload = ghostPayload([
      sample(0, 0.25, { moveY: 1, buttons: InputButton.SPRINT }),
      sample(1, 0.5, { moveY: 1, moveX: -0.5, buttons: InputButton.SPRINT | InputButton.JUMP }),
      sample(2, 0.75, { moveY: 0 }),
    ]);
    const ghost = decodeGhostFromBase64(payload)!;
    const script = ghostToInputScript(ghost, true);
    expect(script.frames.map((r) => r[0])).toEqual([0, 6, 12]);
    expect(script.frames[1].slice(1, 6)).toEqual([-0.5, 1, 0, 0, InputButton.SPRINT | InputButton.JUMP]);
    expect(script.frames[0][6]).toBeCloseTo(0.25, 5);
    expect(script.frames[2][6]).toBeCloseTo(0.75, 5);
    expect(script.frames[2][7]).toBeCloseTo(-0.1, 5);
    // It is a valid ScriptedSource script.
    expect(parseInputScript(script).frames).toHaveLength(3);
    // A raft replay keeps the camera rig: no look columns.
    expect(ghostToInputScript(ghost, false).frames[0]).toHaveLength(6);
  });

  it('drives a ScriptedSource that holds the recorded look per row', () => {
    const ghost = decodeGhostFromBase64(ghostPayload([sample(0, 0.25, { moveY: 1 }), sample(1, -0.5, { moveY: 0.5 })]))!;
    const source = new ScriptedSource(parseInputScript(ghostToInputScript(ghost, true)), () => true);
    const hub = new InputHub();
    hub.registerSource(source);
    for (let f = 1; f <= 6; f += 1) hub.tick(INPUT_FIXED_DT_MS, f);
    expect(hub.readFrame().moveY).toBe(1);
    expect(source.currentLook()?.[0]).toBeCloseTo(0.25, 5);
    hub.tick(INPUT_FIXED_DT_MS, 7);
    expect(hub.readFrame().moveY).toBe(0.5);
    expect(source.currentLook()?.[0]).toBeCloseTo(-0.5, 5);
  });
});

describe('replay ghost files', () => {
  it('carry the seed, vehicle and day, and a replay plan restores them', () => {
    const script = normalizeWeatherScript([
      { atReachFraction: 0, weather: 'clear' },
      { atReachFraction: 0.4, weather: 'storm', intensity: 0.9, rampSeconds: 30, overSegment: 5 },
    ]);
    const json = exportGhostToJson(
      'meander',
      12_300,
      ghostPayload([sample(0, 0, { moveY: 1 })]),
      [{ segmentIndex: 1, tMs: 4000, speed: 9 }],
      { launchHour: 14, hydroEventHash: 'abc', qualityPreset: 'medium' },
      { seed: 777, vehicle: 'runner', conditions: { weatherScript: script, temperature: 9.5, snowpackIndex: 0.4, dailyKey: '2026-10-21' } },
    );
    const imported = importGhostFromJson(json);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const plan = replayPlanFromFile(imported.file)!;
    expect(plan.mapId).toBe('meander');
    expect(plan.launchHour).toBe(14);
    expect(plan.seed).toBe(777);
    expect(plan.vehicle).toBe('runner');
    expect(plan.conditions?.weatherScript).toEqual(script);
    expect(plan.conditions?.dailyKey).toBe('2026-10-21');
    expect(plan.script.frames).toHaveLength(1);
  });

  it('refuses a file whose conditions the save could not store', () => {
    const bad = JSON.parse(
      exportGhostToJson('meander', 1, ghostPayload([sample(0, 0, {})]), undefined, undefined, {
        conditions: { weatherScript: constantWeatherScript(), temperature: 8, snowpackIndex: 0.65 },
      }),
    );
    bad.conditions.weatherScript[0].weather = 'hail';
    expect(importGhostFromJson(JSON.stringify(bad)).ok).toBe(false);
    bad.conditions = { weatherScript: [], temperature: 8, snowpackIndex: 2 };
    expect(importGhostFromJson(JSON.stringify(bad)).ok).toBe(false);
  });

  it('a pre-replay v4 file (no seed / vehicle / day) still replays as a runner on the default day', () => {
    const json = exportGhostToJson('glacial', 1, ghostPayload([sample(0, 0, { moveY: 1 })]));
    const imported = importGhostFromJson(json);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const plan = replayPlanFromFile(imported.file)!;
    expect(plan.vehicle).toBe('runner');
    expect(plan.seed).toBeUndefined();
    expect(plan.conditions).toBeUndefined();
    expect(replayPlanFromFile({ ...imported.file, mapId: 'atlantis' })).toBeNull();
  });
});

describe('?replay=', () => {
  it('is same-origin only and puts the page in scripted mode', () => {
    expect(getReplayGhostUrl('?replay=./run.wsghost')).toBe(new URL('./run.wsghost', window.location.href).href);
    expect(getReplayGhostUrl('?replay=https://evil.example/run.wsghost')).toBeNull();
    expect(getReplayGhostUrl('')).toBeNull();
    expect(isScriptedInputMode('?replay=./run.wsghost')).toBe(true);
    expect(isScriptedInputMode('?map=meander')).toBe(false);
  });
});
