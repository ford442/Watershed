/**
 * Worklet-vs-fallback selection for the speed-wind bed, against a mocked
 * AudioContext (jsdom has no Web Audio). Uses the real THREE.Audio and the
 * real module loader, so "which path did we take" is decided by exactly what
 * the browser would decide it on: `audioWorklet.addModule` and
 * `AudioWorkletNode`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import { AUDIO_CONFIG } from '../../constants/audioConfig';
import { SPEED_WIND_PARAM_DESCRIPTORS, SPEED_WIND_PROCESSOR } from './speedWindDsp';
import { createSpeedWindVoice } from './speedWindVoice';
import { loadSpeedWindWorklet } from './speedWindWorklet';

function fakeParam(value = 0) {
  return { value, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() };
}

function fakeNode(extra: Record<string, unknown> = {}) {
  return { connect: vi.fn(), disconnect: vi.fn(), ...extra };
}

function fakeContext(audioWorklet: unknown) {
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    audioWorklet,
    createGain: () => fakeNode({ gain: fakeParam(1) }),
    createBiquadFilter: () => fakeNode({ type: 'lowpass', frequency: fakeParam(350), Q: fakeParam(1) }),
    createBufferSource: () =>
      fakeNode({
        buffer: null,
        loop: false,
        start: vi.fn(),
        stop: vi.fn(),
        playbackRate: fakeParam(1),
        detune: fakeParam(0),
      }),
  };
  return ctx;
}

function fakeListener(ctx: ReturnType<typeof fakeContext>) {
  const input = fakeNode();
  return { context: ctx, getInput: () => input } as unknown as THREE.AudioListener;
}

class FakeWorkletNode {
  static constructed: FakeWorkletNode[] = [];
  parameters = new Map(SPEED_WIND_PARAM_DESCRIPTORS.map((d) => [d.name, fakeParam(d.defaultValue)]));
  port = { postMessage: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();
  constructor(
    readonly context: unknown,
    readonly name: string,
    readonly options: { processorOptions?: unknown; outputChannelCount?: number[] },
  ) {
    FakeWorkletNode.constructed.push(this);
  }
}

const fallbackBuffer = { duration: 4, numberOfChannels: 2, sampleRate: 48000 } as unknown as AudioBuffer;
const input = { speed: 15, sfxVolume: 1, wetness: 1, wallTightness: 0, gurgle: 0.4 };

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorkletNode.constructed = [];
});

describe('createSpeedWindVoice', () => {
  it('uses the worklet when addModule succeeds', async () => {
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    const addModule = vi.fn().mockResolvedValue(undefined);
    const ctx = fakeContext({ addModule });
    const getFallbackBuffer = vi.fn(() => fallbackBuffer);

    const voice = await createSpeedWindVoice({ listener: fakeListener(ctx), getFallbackBuffer });

    expect(voice?.kind).toBe('worklet');
    expect(addModule).toHaveBeenCalledTimes(1);
    expect(getFallbackBuffer).not.toHaveBeenCalled();

    const node = FakeWorkletNode.constructed[0];
    expect(node.name).toBe(SPEED_WIND_PROCESSOR);
    expect(node.options.outputChannelCount).toEqual([2]);

    voice!.update({ ...input, wetness: 0.7, wallTightness: 0.78 }, 1 / 60);
    // Parameters are forwarded raw — the processor owns the curves.
    expect(node.parameters.get('speed')!.value).toBe(15);
    expect(node.parameters.get('wetness')!.value).toBeCloseTo(0.7);
    expect(node.parameters.get('wallTightness')!.value).toBeCloseTo(0.78);
    expect(node.parameters.get('gurgle')!.value).toBeCloseTo(0.4);

    // Carrier gain is the constant part only (wetness is applied in-worklet).
    const carrier = voice!.audio.gain.gain as unknown as ReturnType<typeof fakeParam>;
    const expected = AUDIO_CONFIG.wind.maxVolume * AUDIO_CONFIG.masterVolume;
    expect(carrier.setTargetAtTime).toHaveBeenLastCalledWith(expect.closeTo(expected, 5), 0, 0.01);

    voice!.reset();
    expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'reset' });
    voice!.dispose();
    expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'dispose' });
  });

  it('falls back to the buffer loop when addModule rejects', async () => {
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const ctx = fakeContext({ addModule: vi.fn().mockRejectedValue(new Error('blocked')) });

    const voice = await createSpeedWindVoice({
      listener: fakeListener(ctx),
      getFallbackBuffer: () => fallbackBuffer,
    });

    expect(voice?.kind).toBe('buffer');
    expect(FakeWorkletNode.constructed).toHaveLength(0);
    expect(voice!.audio.buffer).toBe(fallbackBuffer);
    expect(voice!.audio.loop).toBe(true);
    expect(voice!.audio.isPlaying).toBe(true);
  });

  it('falls back when the context has no AudioWorklet at all', async () => {
    const ctx = fakeContext(undefined);
    const voice = await createSpeedWindVoice({
      listener: fakeListener(ctx),
      getFallbackBuffer: () => fallbackBuffer,
    });
    expect(voice?.kind).toBe('buffer');
  });

  it('falls back when the processor cannot be constructed', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubGlobal(
      'AudioWorkletNode',
      class {
        constructor() {
          throw new Error('InvalidStateError: processor not registered');
        }
      },
    );
    const ctx = fakeContext({ addModule: vi.fn().mockResolvedValue(undefined) });
    const voice = await createSpeedWindVoice({
      listener: fakeListener(ctx),
      getFallbackBuffer: () => fallbackBuffer,
    });
    expect(voice?.kind).toBe('buffer');
  });

  it('fallback honours the wetness duck and the SFX channel', async () => {
    const ctx = fakeContext(undefined);
    const voice = (await createSpeedWindVoice({
      listener: fakeListener(ctx),
      getFallbackBuffer: () => fallbackBuffer,
    }))!;
    const carrier = voice.audio.gain.gain as unknown as ReturnType<typeof fakeParam>;
    const lastVolume = () => carrier.setTargetAtTime.mock.calls.at(-1)![0] as number;

    // Converge the follower at mid speed.
    for (let i = 0; i < 300; i += 1) voice.update(input, 1 / 60);
    const dry = lastVolume();
    expect(dry).toBeGreaterThan(0);

    for (let i = 0; i < 5; i += 1) voice.update({ ...input, wetness: 0.65 }, 1 / 60);
    expect(lastVolume()).toBeCloseTo(dry * 0.65, 5);

    voice.update({ ...input, sfxVolume: 0 }, 1 / 60);
    expect(lastVolume()).toBe(0);
  });

  it('resolves null when neither path is possible', async () => {
    const ctx = fakeContext(undefined);
    const voice = await createSpeedWindVoice({ listener: fakeListener(ctx), getFallbackBuffer: () => null });
    expect(voice).toBeNull();
  });
});

describe('loadSpeedWindWorklet', () => {
  it('loads the module once per context and never rejects', async () => {
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const addModule = vi.fn().mockRejectedValue(new Error('404'));
    const ctx = fakeContext({ addModule }) as unknown as BaseAudioContext;

    await expect(loadSpeedWindWorklet(ctx, '/w.js')).resolves.toBe(false);
    await expect(loadSpeedWindWorklet(ctx, '/w.js')).resolves.toBe(false);
    expect(addModule).toHaveBeenCalledTimes(1);
  });
});
