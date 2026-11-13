/**
 * tracePass — one trace span per post pass (#559 D).
 *
 * Three's output (`renderer.setEffects`, WebGLOutput) calls each effect's
 * `render(renderer, writeBuffer, readBuffer, deltaTime)`; this wraps that
 * method once per pass instance so a recording sees `post:<name>` spans nested
 * in the frame's `render` span. The CPU side of the pass only — GPU time is the
 * frame's `gpu frame ms` counter. Not recording: one extra call and a null
 * check, no allocation (fixed arity, no rest arguments).
 */
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { traceEnd, traceName, traceRecording, traceStart } from '../../debug/trace/traceProbe';

const traced = new WeakSet<Pass>();

type PassRender = Pass['render'];

export function tracePass(pass: Pass, name: string): void {
  if (traced.has(pass)) return;
  traced.add(pass);
  const id = traceName(`post:${name}`);
  const inner: PassRender = pass.render.bind(pass);
  pass.render = (renderer, writeBuffer, readBuffer, deltaTime, maskActive) => {
    if (!traceRecording()) {
      inner(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      return;
    }
    const start = traceStart();
    inner(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    traceEnd(id, start);
  };
}
