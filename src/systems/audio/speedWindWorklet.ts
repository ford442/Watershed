/**
 * speedWindWorklet.ts — main-thread side of the speed-wind AudioWorklet.
 *
 * `?worker&url` makes Vite bundle the processor (and the DSP it imports) into
 * its own content-hashed chunk and hand back the URL, so the deploy treats it
 * like every other hashed asset. `addModule` runs once per AudioContext; any
 * failure (no AudioWorklet, blocked module, bad chunk) resolves `false` and the
 * caller keeps the pre-baked buffer loop (speedWindBuffer.ts).
 */

import speedWindWorkletUrl from './worklets/speedWind.worklet.ts?worker&url';
import {
  SPEED_WIND_PROCESSOR,
  type SpeedWindDspOptions,
  type SpeedWindParamName,
} from './speedWindDsp';

const moduleLoads = new WeakMap<BaseAudioContext, Promise<boolean>>();

/** Whether this context can host an AudioWorklet at all. */
export function supportsAudioWorklet(ctx: BaseAudioContext | null | undefined): boolean {
  return (
    !!ctx &&
    typeof (ctx as { audioWorklet?: AudioWorklet }).audioWorklet?.addModule === 'function' &&
    typeof globalThis.AudioWorkletNode === 'function'
  );
}

/** Load the processor module once per context; never rejects. */
export function loadSpeedWindWorklet(
  ctx: BaseAudioContext,
  url: string = speedWindWorkletUrl,
): Promise<boolean> {
  const cached = moduleLoads.get(ctx);
  if (cached) return cached;

  const load = supportsAudioWorklet(ctx)
    ? ctx.audioWorklet.addModule(url).then(
        () => true,
        (error: unknown) => {
          console.info('[SpeedWind] AudioWorklet unavailable, using buffer loop:', error);
          return false;
        },
      )
    : Promise.resolve(false);
  moduleLoads.set(ctx, load);
  return load;
}

export type SpeedWindNodeParams = Record<SpeedWindParamName, AudioParam>;

/**
 * Instantiate the processor as a stereo source node. Returns null if the
 * constructor throws (e.g. the module registered under another name).
 */
export function createSpeedWindNode(
  ctx: BaseAudioContext,
  options: SpeedWindDspOptions,
): { node: AudioWorkletNode; params: SpeedWindNodeParams } | null {
  try {
    const node = new AudioWorkletNode(ctx, SPEED_WIND_PROCESSOR, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: options,
    });
    const get = (name: SpeedWindParamName) => {
      const param = node.parameters.get(name);
      if (!param) throw new Error(`speed-wind worklet is missing AudioParam "${name}"`);
      return param;
    };
    return {
      node,
      params: {
        speed: get('speed'),
        wetness: get('wetness'),
        wallTightness: get('wallTightness'),
        gurgle: get('gurgle'),
      },
    };
  } catch (error) {
    console.info('[SpeedWind] AudioWorkletNode construction failed, using buffer loop:', error);
    return null;
  }
}
