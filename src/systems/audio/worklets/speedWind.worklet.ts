/**
 * speedWind.worklet.ts — AudioWorklet processor for the speed-wind bed and
 * close-water gurgle.
 *
 * Bundled by Vite as its own chunk (`?worker&url` in speedWindWorklet.ts), so
 * the DSP import below is inlined and the emitted file is content-hashed like
 * any other asset. All synthesis lives in speedWindDsp.ts, where it is tested.
 *
 * Runs in AudioWorkletGlobalScope: no DOM, no Three.js, no `window`.
 */

import {
  SPEED_WIND_PARAM_DESCRIPTORS,
  SPEED_WIND_PROCESSOR,
  SpeedWindSynth,
  type SpeedWindDspOptions,
  type SpeedWindFrameParams,
  type SpeedWindMessage,
} from '../speedWindDsp';

// AudioWorkletGlobalScope globals (not in the DOM lib this project compiles with).
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}

class SpeedWindProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return SPEED_WIND_PARAM_DESCRIPTORS;
  }

  private readonly synth: SpeedWindSynth;
  private readonly frame: SpeedWindFrameParams = { speed: 0, wetness: 1, wallTightness: 0, gurgle: 0 };
  private alive = true;

  constructor(options?: { processorOptions?: SpeedWindDspOptions }) {
    super(options);
    this.synth = new SpeedWindSynth(sampleRate, options?.processorOptions ?? {});
    this.port.onmessage = (event: MessageEvent<SpeedWindMessage>) => {
      if (event.data?.type === 'reset') this.synth.reset();
      else if (event.data?.type === 'dispose') this.alive = false;
    };
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const out = outputs[0];
    if (out && out[0]) {
      this.frame.speed = parameters.speed?.[0] ?? 0;
      this.frame.wetness = parameters.wetness?.[0] ?? 1;
      this.frame.wallTightness = parameters.wallTightness?.[0] ?? 0;
      this.frame.gurgle = parameters.gurgle?.[0] ?? 0;
      this.synth.process(out[0], out[1], this.frame);
    }
    // Returning false lets the node be collected once the main thread drops it.
    return this.alive;
  }
}

registerProcessor(SPEED_WIND_PROCESSOR, SpeedWindProcessor);
