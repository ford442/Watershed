/**
 * pauseBus.ts — the one hand-off from the input frame to the app (#486 B).
 *
 * `<InputHubTick />` watches the `PAUSE` bit and calls `emitPauseRequest()` on
 * its rising edge; App.tsx is the single subscriber and decides what pausing
 * means (menu phase, pointer lock, settings panel). A gamepad's Start button
 * and the touch Pause button both arrive here, so a player with no keyboard has
 * a way to pause without a UI event ever being involved.
 */

type Listener = () => void;

const listeners: Listener[] = [];

export function onPauseRequest(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    const i = listeners.indexOf(listener);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function emitPauseRequest(): void {
  for (let i = 0; i < listeners.length; i += 1) listeners[i]();
}

/** Edge detector over the frame's button word: true once per press. */
export function pauseEdge(prevButtons: number, buttons: number, pauseBit: number): boolean {
  return (buttons & pauseBit) !== 0 && (prevButtons & pauseBit) === 0;
}
