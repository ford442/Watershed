/**
 * TouchControls.tsx — the on-screen controls layer (#486 C).
 *
 * Mounted by App only while the run is live on a touch device
 * (`isTouchInputMode()`: `(pointer: coarse)` or `?input=touch`). It owns a
 * `TouchSource` registered with the InputHub, so the vehicles read the same
 * `InputFrame` a keyboard or gamepad produces.
 *
 *   move half   floating stick (ring + knob drawn where the thumb landed)
 *   look half   drag to look
 *   buttons     JUMP, PAUSE, and — on the raft — a paddle per side
 *
 * The layer's padding is `env(safe-area-inset-*)`, so buttons and the stick's
 * starting zone stay clear of a notch and the home indicator. Left-handed
 * play mirrors the whole layout. The knob is moved by writing a transform from a
 * rAF loop, not through React state — a thumb move never re-renders anything.
 */

import React, { useEffect, useRef } from 'react';
import { inputHub } from '../input/InputHub';
import { TouchSource, type TouchTuning } from '../input/sources/TouchSource';
import { readViewport, stickRadiusPx } from '../input/handheld';
import { useSettingsStore } from '../systems/settings/useSettingsStore';
import { useGameStore } from '../systems/GameState';

/** Stick dead zone as a fraction of the radius. */
const TOUCH_DEADZONE = 0.12;

export const TouchControls: React.FC = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const leftHanded = useSettingsStore((s) => s.leftHanded);
  const isRaft = useGameStore((s) => s.vehicleType === 'raft');

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const tuning: TouchTuning = { leftHanded: false, deadzone: TOUCH_DEADZONE, radius: 64 };
    const refresh = () => {
      const { width, height } = readViewport();
      tuning.leftHanded = useSettingsStore.getState().leftHanded;
      tuning.radius = stickRadiusPx(width, height);
      root.style.setProperty('--touch-stick-radius', `${tuning.radius}px`);
    };
    refresh();
    const unsubscribe = useSettingsStore.subscribe(refresh);
    window.addEventListener('resize', refresh);

    const source = new TouchSource(() => tuning);
    source.attach(root);
    inputHub.registerSource(source);

    let raf = 0;
    const draw = () => {
      const v = source.getStickVisual();
      const base = baseRef.current;
      const knob = knobRef.current;
      if (base && knob) {
        if (v.active) {
          const rect = root.getBoundingClientRect();
          base.style.opacity = '1';
          base.style.transform = `translate(${v.originX - rect.left}px, ${v.originY - rect.top}px) translate(-50%, -50%)`;
          const m = Math.sqrt(v.dx * v.dx + v.dy * v.dy);
          const k = m > tuning.radius ? tuning.radius / m : 1;
          knob.style.transform = `translate(${v.dx * k}px, ${v.dy * k}px)`;
        } else {
          base.style.opacity = '0';
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      window.removeEventListener('resize', refresh);
      inputHub.unregisterSource(source.id, source);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={`touch-controls ${leftHanded ? 'touch-controls--left-handed' : ''}`}
      data-testid="touch-controls"
      aria-hidden="false"
    >
      <div ref={baseRef} className="touch-stick-base" aria-hidden="true">
        <div ref={knobRef} className="touch-stick-knob" />
      </div>

      <button type="button" className="touch-btn touch-btn--pause" data-touch="pause" aria-label="Pause">
        <span aria-hidden="true">II</span>
      </button>

      <div className="touch-actions">
        {isRaft && (
          <>
            <button type="button" className="touch-btn touch-btn--paddle touch-btn--paddle-l" data-touch="paddleL" aria-label="Paddle left">
              L
            </button>
            <button type="button" className="touch-btn touch-btn--paddle touch-btn--paddle-r" data-touch="paddleR" aria-label="Paddle right">
              R
            </button>
          </>
        )}
        {!isRaft && (
          <button type="button" className="touch-btn touch-btn--jump" data-touch="jump" aria-label="Jump">
            JUMP
          </button>
        )}
      </div>
    </div>
  );
};

export default TouchControls;
