import * as THREE from 'three';
import { installTraceSink, traceNameTable } from '../debug/trace/traceProbe';
import { createTraceRing, readTraceEvent } from '../debug/trace/traceBuffer';
import { installRenderTargetTrace, sampleRenderTargetTrace } from './traceRenderTargets';

describe('installRenderTargetTrace', () => {
  it('records first binds and only size changes', () => {
    const ring = createTraceRing(16);
    const renderer: {
      setRenderTarget: (target: THREE.RenderTarget | null, activeCubeFace?: number, activeMipmapLevel?: number) => void;
    } = { setRenderTarget: () => {} };
    installTraceSink(ring);
    const detach = installRenderTargetTrace(renderer);
    try {
      const target = new THREE.WebGLRenderTarget(1, 1);
      renderer.setRenderTarget(target);
      renderer.setRenderTarget(target);
      target.setSize(2, 2);
      target.setSize(2, 2);
      renderer.setRenderTarget(new THREE.WebGLRenderTarget(1, 1));
      sampleRenderTargetTrace();
    } finally {
      detach();
      installTraceSink(null);
    }

    const table = traceNameTable();
    const snapshot = ring.snapshot(table.names, table.tracks);
    const counters = Array.from({ length: snapshot.count }, (_, i) => {
      const event = readTraceEvent(snapshot.events, i);
      return { name: snapshot.names[event.id], value: event.value };
    });
    expect(counters.filter((event) => event.name === 'render targets first bound').map((event) => event.value))
      .toEqual([2]);
    expect(counters.filter((event) => event.name === 'render target resizes').map((event) => event.value))
      .toEqual([1]);
  });
});
