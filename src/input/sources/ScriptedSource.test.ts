import { afterEach, describe, expect, it } from 'vitest';
import { parseInputScript, ScriptedSource } from './ScriptedSource';
import { InputHub } from '../InputHub';
import { InputButton, INPUT_FIXED_DT_MS } from '../InputFrame';
import { getInputScriptUrl, isScriptedInputMode } from '../scriptedRun';

const DT = INPUT_FIXED_DT_MS;

describe('parseInputScript', () => {
  it('sorts rows, clamps axes and masks buttons', () => {
    const script = parseInputScript({
      version: 1,
      dtMs: 16.6667,
      headingYaw: 0.5,
      frames: [
        [10, 0, 2, 0, 0, 0],
        [0, -3, 1, 1.5, -1, 0xff],
      ],
    });
    expect(script.frames.map((r) => r[0])).toEqual([0, 10]);
    expect(script.frames[0]).toEqual([0, -1, 1, 1, 0, 0x3f]);
    expect(script.frames[1][2]).toBe(1);
    expect(script.headingYaw).toBe(0.5);
  });

  it('defaults dtMs and leaves headingYaw out when absent', () => {
    const script = parseInputScript({ version: 1, frames: [[0, 0, 1, 0, 0, 0]] });
    expect(script.dtMs).toBeCloseTo(DT);
    expect('headingYaw' in script).toBe(false);
  });

  it.each([
    [null],
    [{ version: 2, frames: [[0, 0, 0, 0, 0, 0]] }],
    [{ version: 1, frames: [] }],
    [{ version: 1, frames: [[0, 0, 0]] }],
    [{ version: 1, frames: [[-1, 0, 0, 0, 0, 0]] }],
    [{ version: 1, frames: [[0.5, 0, 0, 0, 0, 0]] }],
    [{ version: 1, dtMs: 0, frames: [[0, 0, 0, 0, 0, 0]] }],
    [{ version: 1, headingYaw: 'north', frames: [[0, 0, 0, 0, 0, 0]] }],
  ])('rejects a malformed script %#', (raw) => {
    expect(() => parseInputScript(raw)).toThrow();
  });
});

describe('ScriptedSource', () => {
  const hub = new InputHub();
  afterEach(() => hub.reset());

  const script = parseInputScript({
    version: 1,
    frames: [
      [0, 0, 1, 0, 0, InputButton.SPRINT],
      [3, 1, 1, 0, 0, InputButton.SPRINT | InputButton.JUMP],
      [5, 0, 1, 0, 0, 0],
    ],
  });

  it('holds each keyframe until the next one', () => {
    hub.registerSource(new ScriptedSource(script, () => true));
    const seen: Array<[number, number]> = [];
    for (let i = 0; i < 8; i += 1) {
      hub.tick(DT, i + 1);
      const f = hub.readFrame();
      seen.push([f.moveX, f.buttons]);
    }
    expect(seen).toEqual([
      [0, InputButton.SPRINT],
      [0, InputButton.SPRINT],
      [0, InputButton.SPRINT],
      [1, InputButton.SPRINT | InputButton.JUMP],
      [1, InputButton.SPRINT | InputButton.JUMP],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
  });

  it('holds at script frame 0 (neutral) until the run is live', () => {
    let live = false;
    const source = new ScriptedSource(script, () => live);
    hub.registerSource(source);
    for (let i = 0; i < 10; i += 1) hub.tick(DT, i + 1);
    expect(source.getScriptFrame()).toBe(0);
    expect(hub.readFrame().moveY).toBe(0);
    expect(source.isRunning()).toBe(false);

    live = true;
    hub.tick(DT, 11);
    expect(source.getScriptFrame()).toBe(1);
    expect(hub.readFrame().moveY).toBe(1);
    expect(hub.readFrame().buttons).toBe(InputButton.SPRINT);
    // Script frame 3 lands three live ticks later, whatever the hub frameIdx.
    hub.tick(DT, 12);
    hub.tick(DT, 13);
    hub.tick(DT, 14);
    expect(hub.readFrame().moveX).toBe(1);
  });

  it('reports nothing before its first keyframe', () => {
    const late = parseInputScript({ version: 1, frames: [[2, 0, 1, 0, 0, 0]] });
    hub.registerSource(new ScriptedSource(late, () => true));
    hub.tick(DT, 1);
    expect(hub.readFrame().moveY).toBe(0);
    hub.tick(DT, 2);
    hub.tick(DT, 3);
    expect(hub.readFrame().moveY).toBe(1);
  });
});

describe('?input=script: URL', () => {
  it('extracts the script url', () => {
    expect(getInputScriptUrl('?map=meander&input=script:/verification/fixtures/input/meander_run.json')).toBe(
      '/verification/fixtures/input/meander_run.json',
    );
    expect(isScriptedInputMode('?input=script:/a.json')).toBe(true);
  });

  it('ignores anything that is not a script input', () => {
    expect(getInputScriptUrl('?map=meander')).toBeNull();
    expect(getInputScriptUrl('?input=gamepad')).toBeNull();
    expect(getInputScriptUrl('?input=script:')).toBeNull();
    expect(isScriptedInputMode('')).toBe(false);
  });
});
