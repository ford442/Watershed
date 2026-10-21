/**
 * InputHub.ts — merges every input device into one InputFrame per sim frame (#486 A).
 *
 * - Sources register by id (`'keyboard-mouse'`, `'scripted'`, …); registering
 *   an id that already exists disposes the old source first, so a React 19
 *   strict-mode double effect never leaves two keyboard listeners alive.
 * - `tick(dtMs, frameIdx)` runs once per frame from `<InputHubTick />` at
 *   useFrame priority −100, ahead of every vehicle. Each source writes its own
 *   per-device scratch; the hub merges (stick = last-active device, buttons =
 *   OR of every device) and clears every scratch, so a release on any device
 *   is honoured the very next tick.
 * - `readFrame()` returns the same object every call: the runner's two
 *   `getControls()` reads in one step see one snapshot.
 * - The ghost latch folds every tick of a 100 ms recorder window (buttons OR,
 *   look sum, time-weighted axis mean) so a 30 ms jump tap survives 10 Hz
 *   sampling. The recorder copies it out with `consumeGhostLatch(into)`.
 *
 * Hot path (`tick`, `readFrame`, `latchForGhost`): indexed loops over
 * preallocated arrays only — no for..of, closures, spread or allocation.
 */

import { create } from 'zustand';
import {
  clearInputFrame,
  createInputFrame,
  type InputFrame,
  type InputSourceId,
} from './InputFrame';

/** What one device reports for one tick. Cleared by the hub after every merge. */
export interface InputDeviceScratch {
  moveX: number;
  moveY: number;
  lookDX: number;
  lookDY: number;
  paddleL: number;
  paddleR: number;
  buttons: number;
}

export interface InputSource {
  readonly id: InputSourceId;
  /** Write this tick's state into `out` (already zeroed). Must not allocate. */
  poll(out: InputDeviceScratch, frameIdx: number, dtMs: number): void;
  /** Release listeners / timers. Called by the hub on unregister or replace. */
  dispose(): void;
}

/** Low-frequency hub state for UI. Never carries the per-frame snapshot. */
export interface InputUiState {
  activeSourceId: InputSourceId;
  isScripted: boolean;
}

export const useInputStore = create<InputUiState>(() => ({
  activeSourceId: 'none',
  isScripted: false,
}));

const MAX_SOURCES = 4;
const AXIS_EPSILON = 1e-3;

function createScratch(): InputDeviceScratch {
  return { moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, paddleL: 0, paddleR: 0, buttons: 0 };
}

function clearScratch(s: InputDeviceScratch): void {
  s.moveX = 0;
  s.moveY = 0;
  s.lookDX = 0;
  s.lookDY = 0;
  s.paddleL = 0;
  s.paddleR = 0;
  s.buttons = 0;
}

function scratchIsActive(s: InputDeviceScratch): boolean {
  return (
    Math.abs(s.moveX) > AXIS_EPSILON ||
    Math.abs(s.moveY) > AXIS_EPSILON ||
    Math.abs(s.paddleL) > AXIS_EPSILON ||
    Math.abs(s.paddleR) > AXIS_EPSILON ||
    Math.abs(s.lookDX) > AXIS_EPSILON ||
    Math.abs(s.lookDY) > AXIS_EPSILON ||
    s.buttons !== 0
  );
}

export class InputHub {
  private readonly sources: (InputSource | null)[] = [];
  private readonly scratches: InputDeviceScratch[] = [];
  private readonly frame: InputFrame = createInputFrame();
  /** Slot of the device that last produced non-neutral input; −1 = none yet. */
  private activeSlot = -1;

  // Ghost latch accumulators (one recorder window).
  private latchButtons = 0;
  private latchLookDX = 0;
  private latchLookDY = 0;
  private latchMoveX = 0;
  private latchMoveY = 0;
  private latchPaddleL = 0;
  private latchPaddleR = 0;
  private latchDtMs = 0;

  // Tick cost, for the < 0.1 ms/frame budget readout.
  private tickCostMs = 0;
  private tickCount = 0;

  constructor() {
    for (let i = 0; i < MAX_SOURCES; i += 1) {
      this.sources.push(null);
      this.scratches.push(createScratch());
    }
  }

  registerSource(source: InputSource): void {
    let slot = this.slotOf(source.id);
    if (slot >= 0) {
      const old = this.sources[slot];
      if (old && old !== source) old.dispose();
    } else {
      slot = this.sources.indexOf(null);
      if (slot < 0) throw new Error(`[InputHub] more than ${MAX_SOURCES} input sources`);
    }
    this.sources[slot] = source;
    clearScratch(this.scratches[slot]);
    this.publishUiState();
  }

  unregisterSource(id: InputSourceId, instance?: InputSource): void {
    const slot = this.slotOf(id);
    if (slot < 0) return;
    const source = this.sources[slot];
    // A stale cleanup (strict-mode double effect) must not tear down the
    // instance that replaced it.
    if (instance && source !== instance) return;
    this.sources[slot] = null;
    clearScratch(this.scratches[slot]);
    if (this.activeSlot === slot) this.activeSlot = -1;
    source?.dispose();
    this.publishUiState();
  }

  hasSource(id: InputSourceId): boolean {
    return this.slotOf(id) >= 0;
  }

  /** Advance one sim frame: poll every source, merge, clear the scratches, latch for the ghost. */
  tick(dtMs: number, frameIdx: number): void {
    const t0 = performance.now();
    const sources = this.sources;
    const scratches = this.scratches;
    const n = sources.length;

    let buttons = 0;
    let firstActive = -1;
    let activeStillActive = false;
    for (let i = 0; i < n; i += 1) {
      const source = sources[i];
      if (!source) continue;
      const s = scratches[i];
      source.poll(s, frameIdx, dtMs);
      buttons |= s.buttons;
      if (scratchIsActive(s)) {
        if (firstActive < 0) firstActive = i;
        if (i === this.activeSlot) activeStillActive = true;
      }
    }

    // Last-active device keeps the stick until it goes neutral and another moves.
    const prevActive = this.activeSlot;
    if (!activeStillActive && firstActive >= 0) this.activeSlot = firstActive;
    if (this.activeSlot >= 0 && !sources[this.activeSlot]) this.activeSlot = -1;

    const f = this.frame;
    f.buttons = buttons;
    f.dtMs = dtMs;
    f.frameIdx = frameIdx;
    f.tMs = frameIdx * dtMs;
    if (this.activeSlot >= 0) {
      const s = scratches[this.activeSlot];
      f.moveX = s.moveX;
      f.moveY = s.moveY;
      f.lookDX = s.lookDX;
      f.lookDY = s.lookDY;
      f.paddleL = s.paddleL;
      f.paddleR = s.paddleR;
      f.source = (sources[this.activeSlot] as InputSource).id;
    } else {
      f.moveX = 0;
      f.moveY = 0;
      f.lookDX = 0;
      f.lookDY = 0;
      f.paddleL = 0;
      f.paddleR = 0;
      f.source = 'none';
    }

    for (let i = 0; i < n; i += 1) clearScratch(scratches[i]);

    this.latchForGhost();
    if (prevActive !== this.activeSlot) this.publishUiState();

    this.tickCostMs += performance.now() - t0;
    this.tickCount += 1;
  }

  /** This frame's merged input. Same object every call. */
  readFrame(): Readonly<InputFrame> {
    return this.frame;
  }

  /** Fold the current frame into the ghost window. `tick` calls this once per frame. */
  latchForGhost(): void {
    const f = this.frame;
    const w = f.dtMs > 0 ? f.dtMs : 0;
    this.latchButtons |= f.buttons;
    this.latchLookDX += f.lookDX;
    this.latchLookDY += f.lookDY;
    this.latchMoveX += f.moveX * w;
    this.latchMoveY += f.moveY * w;
    this.latchPaddleL += f.paddleL * w;
    this.latchPaddleR += f.paddleR * w;
    this.latchDtMs += w;
  }

  /**
   * Copy the window folded since the last call into `into` and start a new one.
   * Axes are the time-weighted mean, look is summed, buttons OR-ed, `dtMs` is
   * the window length. Allocates nothing; `into` is never the hub's own frame.
   */
  consumeGhostLatch(into: InputFrame): InputFrame {
    const span = this.latchDtMs;
    const inv = span > 0 ? 1 / span : 0;
    into.moveX = this.latchMoveX * inv;
    into.moveY = this.latchMoveY * inv;
    into.lookDX = this.latchLookDX;
    into.lookDY = this.latchLookDY;
    into.paddleL = this.latchPaddleL * inv;
    into.paddleR = this.latchPaddleR * inv;
    into.buttons = this.latchButtons;
    into.dtMs = span;
    into.frameIdx = this.frame.frameIdx;
    into.tMs = this.frame.tMs;
    into.source = this.frame.source;
    this.resetGhostLatch();
    return into;
  }

  resetGhostLatch(): void {
    this.latchButtons = 0;
    this.latchLookDX = 0;
    this.latchLookDY = 0;
    this.latchMoveX = 0;
    this.latchMoveY = 0;
    this.latchPaddleL = 0;
    this.latchPaddleR = 0;
    this.latchDtMs = 0;
  }

  /** Mean `tick` cost so far (ms/frame) and the number of ticks measured. */
  getTickStats(): { meanMs: number; ticks: number } {
    return { meanMs: this.tickCount > 0 ? this.tickCostMs / this.tickCount : 0, ticks: this.tickCount };
  }

  resetTickStats(): void {
    this.tickCostMs = 0;
    this.tickCount = 0;
  }

  /** Tests only: drop every source and zero the frame. */
  reset(): void {
    for (let i = 0; i < this.sources.length; i += 1) {
      const source = this.sources[i];
      this.sources[i] = null;
      clearScratch(this.scratches[i]);
      source?.dispose();
    }
    this.activeSlot = -1;
    clearInputFrame(this.frame);
    this.frame.source = 'none';
    this.resetGhostLatch();
    this.resetTickStats();
    this.publishUiState();
  }

  private slotOf(id: InputSourceId): number {
    for (let i = 0; i < this.sources.length; i += 1) {
      if (this.sources[i]?.id === id) return i;
    }
    return -1;
  }

  private publishUiState(): void {
    const activeSourceId = this.activeSlot >= 0 ? (this.sources[this.activeSlot]?.id ?? 'none') : 'none';
    const isScripted = this.hasSource('scripted');
    const prev = useInputStore.getState();
    if (prev.activeSourceId !== activeSourceId || prev.isScripted !== isScripted) {
      useInputStore.setState({ activeSourceId, isScripted });
    }
  }
}

/** The app's single hub. */
export const inputHub = new InputHub();
