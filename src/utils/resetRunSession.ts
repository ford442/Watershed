/**
 * Resets ambient session state after journey loop / map restart.
 * Keeps audio, weather, flow, and canyon acoustics from sticking in end-of-map mode.
 */

import { getAudioManager } from '../systems/audio/AudioSystem';
import { gameEvents, type RunResetDetail } from '../systems/events/GameEvents';
import { CLEAR_WEATHER, useGameStore } from '../systems/GameState';

export type RunSessionResetDetail = RunResetDetail;

export function resetRunSession(detail: RunSessionResetDetail = {}): void {
  if (typeof window === 'undefined') return;

  const flowSpeed = detail.flowSpeed ?? 1;
  if (Number.isFinite(flowSpeed)) {
    (window as any).__watershedFlowSpeed = flowSpeed;
    (window as any).__watershedSlipperiness = 0;
  }

  useGameStore.getState().setWeather(CLEAR_WEATHER);
  gameEvents.emit('water-flow-update', { flowSpeed, turbulence: 0, state: 'Normal' });
  gameEvents.emit('watershed-run-reset', detail);

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
