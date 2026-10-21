/**
 * replay.ts — `?replay=<ghost-url>`: re-run a v4 ghost's recorded inputs on its river.
 *
 * A v4 ghost carries, beside its poses, the input the player gave in each 10 Hz
 * window (InputHub's latch: mean stick, OR-ed buttons, the window's length).
 * Here that track becomes an input script for ScriptedSource — one keyframe
 * per window, `round(dtMs / (1000/60))` sim frames long — and the ghost file
 * says which river to run it on: map, launch hour, procedural seed, and the
 * day's conditions (weather script, melt). Run on the fixed scripted clock,
 * two replays of one ghost are the same run frame for frame: identical splits
 * and identical SWE state at each split (`pnpm test:replay-smoke`).
 *
 * The runner's pose is its camera, so a runner replay also holds the recorded
 * yaw/pitch per window (movement is camera-relative). A ghost recorded from a
 * scripted run replays exactly; a human run replays to within what a 10 Hz
 * window can say about 60 Hz input.
 *
 * Loaded on demand (`?replay=` pages only); nothing here is on the boot path.
 */
import * as THREE from 'three';
import { decodeGhostFromBase64, GHOST_FLOATS_PER_SAMPLE, readGhostInput, type DecodedGhost } from '../systems/ghost/ghostCodec';
import { importGhostFromJson, type WsGhostFile } from '../systems/ghost/ghostExport';
import { isMapRegistryId, type MapRegistryId } from '../maps/registry';
import type { RunConditions } from '../systems/journey/runSession';
import { normalizeWeatherScript } from '../systems/weather/weatherScript';
import { createInputFrame, INPUT_FIXED_DT_MS } from './InputFrame';
import type { InputScript, InputScriptRow } from './sources/ScriptedSource';

export interface ReplayPlan {
  file: WsGhostFile;
  mapId: MapRegistryId;
  launchHour: number | undefined;
  seed: number | undefined;
  vehicle: 'runner' | 'raft';
  conditions: RunConditions | undefined;
  script: InputScript;
}

const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * The ghost's input track as a ScriptedSource script. `holdCamera` (runner)
 * appends each sample's camera yaw/pitch, read from its pose quaternion.
 */
export function ghostToInputScript(ghost: DecodedGhost, holdCamera: boolean): InputScript {
  const frames: InputScriptRow[] = [];
  const input = createInputFrame();
  let frameIdx = 0;
  for (let i = 0; i < ghost.sampleCount; i += 1) {
    readGhostInput(ghost, i, input);
    const row: [number, number, number, number, number, number] = [
      frameIdx,
      input.moveX,
      input.moveY,
      input.paddleL,
      input.paddleR,
      input.buttons,
    ];
    if (holdCamera) {
      const o = i * GHOST_FLOATS_PER_SAMPLE;
      const s = ghost.samples;
      _quat.set(s[o + 3], s[o + 4], s[o + 5], s[o + 6]);
      if (_quat.lengthSq() > 1e-8) _quat.normalize();
      else _quat.identity();
      _euler.setFromQuaternion(_quat, 'YXZ');
      frames.push([...row, _euler.y, _euler.x]);
    } else {
      frames.push(row);
    }
    // The window this sample folded, in fixed sim frames (6 at 10 Hz on a 60 Hz clock).
    frameIdx += Math.max(1, Math.round(input.dtMs / INPUT_FIXED_DT_MS));
  }
  if (frames.length === 0) frames.push([0, 0, 0, 0, 0, 0]);
  return { version: 1, dtMs: INPUT_FIXED_DT_MS, frames };
}

/** Everything a replay needs from a parsed ghost file; null when it cannot be replayed. */
export function replayPlanFromFile(file: WsGhostFile): ReplayPlan | null {
  if (!isMapRegistryId(file.mapId)) return null;
  const ghost = decodeGhostFromBase64(file.ghostData);
  if (!ghost || ghost.sampleCount === 0) return null;
  const vehicle = file.vehicle ?? 'runner';
  const conditions = file.conditions
    ? { ...file.conditions, weatherScript: normalizeWeatherScript(file.conditions.weatherScript) }
    : undefined;
  return {
    file,
    mapId: file.mapId,
    launchHour: file.launchHour,
    seed: file.seed,
    vehicle,
    conditions,
    script: ghostToInputScript(ghost, vehicle === 'runner'),
  };
}

const plans = new Map<string, Promise<ReplayPlan | null>>();

/** Fetch and parse the ghost at `url` once per page; null (with a console error) when unusable. */
export function loadReplayPlan(url: string): Promise<ReplayPlan | null> {
  let plan = plans.get(url);
  if (!plan) {
    plan = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((json) => {
        const result = importGhostFromJson(json);
        if (!result.ok) throw new Error(`ghost file rejected (${result.reason})`);
        const next = replayPlanFromFile(result.file);
        if (!next) throw new Error('ghost has no replayable input track');
        return next;
      })
      .catch((err: unknown) => {
        console.error(`[replay] ${url} cannot be replayed:`, err);
        return null;
      });
    plans.set(url, plan);
  }
  return plan;
}
