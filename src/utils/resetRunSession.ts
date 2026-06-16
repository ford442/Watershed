/**
 * Resets ambient session state after journey loop / map restart.
 * Keeps audio, weather, flow, and canyon acoustics from sticking in end-of-map mode.
 */

import { getAudioManager } from '../systems/AudioSystem';

export type RunSessionResetDetail = {
  biome?: string;
  flowSpeed?: number;
  segmentIndex?: number;
};

export function resetRunSession(detail: RunSessionResetDetail = {}): void {
  if (typeof window === 'undefined') return;

  const flowSpeed = detail.flowSpeed ?? 1;
  if (Number.isFinite(flowSpeed)) {
    (window as any).__watershedFlowSpeed = flowSpeed;
    (window as any).__watershedSlipperiness = 0;
  }

  window.dispatchEvent(
    new CustomEvent('weather-update', {
      detail: { type: 'clear', intensity: 0 },
    })
  );

  window.dispatchEvent(
    new CustomEvent('water-flow-update', {
      detail: {
        flowSpeed,
        turbulence: 0,
        state: 'Normal',
      },
    })
  );

  window.dispatchEvent(
    new CustomEvent('watershed-run-reset', {
      detail,
    })
  );

  const am = getAudioManager();
  am?.disableCanyonAcoustics();
  am?.setReactiveVolumes({
    low: 0,
    mid: 0,
    high: 0,
    rapids: 0,
    whoosh: 0,
    transition: 0,
  });
}
