import { useEffect, useRef } from 'react';
import { useGameStore, type GameStore } from '../systems/GameState';

/** The F3 movement readout's panel (MovementReadout.tsx holds the toggle; this loads on first open). */

type Select = (s: GameStore) => string;
const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '—');
const selectX: Select = (s) => fmt(s.playerPosition.x);
const selectY: Select = (s) => fmt(s.playerPosition.y);
const selectZ: Select = (s) => fmt(s.playerPosition.z);
const selectSpeed: Select = (s) => fmt(s.currentSpeed);
const selectDistance: Select = (s) => Math.round(s.distance).toString();

function Leaf({ select }: { select: Select }) {
  return <>{useGameStore(select)}</>;
}

/** `KeyboardEvent.code` → chip. Arrow codes are the same actions as WASD. */
const KEY_CHIPS: ReadonlyArray<{ label: string; codes: readonly string[] }> = [
  { label: 'W', codes: ['KeyW'] },
  { label: 'A', codes: ['KeyA'] },
  { label: 'S', codes: ['KeyS'] },
  { label: 'D', codes: ['KeyD'] },
  { label: '↑', codes: ['ArrowUp'] },
  { label: '←', codes: ['ArrowLeft'] },
  { label: '↓', codes: ['ArrowDown'] },
  { label: '→', codes: ['ArrowRight'] },
  { label: 'SPACE', codes: ['Space'] },
  { label: 'SHIFT', codes: ['ShiftLeft', 'ShiftRight'] },
  { label: 'M1', codes: ['Mouse0'] },
  { label: 'M2', codes: ['Mouse2'] },
];

export default function MovementReadoutPanel() {
  const chipRefs = useRef(new Map<string, HTMLSpanElement>());
  const mouseRef = useRef<HTMLSpanElement>(null);
  const lockRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const down = new Set<string>();
    let mouseDx = 0;
    let mouseDy = 0;
    let lastMouseMs = 0;

    const paint = () => {
      chipRefs.current.forEach((el, label) => {
        const chip = KEY_CHIPS.find((c) => c.label === label);
        const active = !!chip && chip.codes.some((code) => down.has(code));
        el.classList.toggle('move-readout__key--down', active);
      });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      down.add(e.code);
      paint();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      down.delete(e.code);
      paint();
    };
    const onMouseDown = (e: MouseEvent) => {
      down.add(`Mouse${e.button}`);
      paint();
    };
    const onMouseUp = (e: MouseEvent) => {
      down.delete(`Mouse${e.button}`);
      paint();
    };
    const onMouseMove = (e: MouseEvent) => {
      mouseDx += e.movementX;
      mouseDy += e.movementY;
      lastMouseMs = performance.now();
    };
    // A key held when the window loses focus never sends keyup.
    const onBlur = () => {
      down.clear();
      paint();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('blur', onBlur);

    let raf = 0;
    const tick = () => {
      const now = performance.now();
      // Mouse delta is shown for a moment after the last movement, then zeroed,
      // so a still mouse reads 0,0 rather than the last stroke forever.
      if (now - lastMouseMs > 250) {
        mouseDx = 0;
        mouseDy = 0;
      }
      if (mouseRef.current) {
        mouseRef.current.textContent = `${Math.round(mouseDx)}, ${Math.round(mouseDy)}`;
      }
      if (lockRef.current) {
        lockRef.current.textContent = document.pointerLockElement ? 'locked' : 'FREE (click to lock)';
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  return (
    <div className="move-readout" data-testid="move-readout" aria-hidden="true">
      <div className="move-readout__title">MOVEMENT · F3 TO HIDE</div>
      <div className="move-readout__row">
        <span>POS x</span>
        <span><Leaf select={selectX} /></span>
      </div>
      <div className="move-readout__row">
        <span>POS y</span>
        <span><Leaf select={selectY} /></span>
      </div>
      <div className="move-readout__row">
        <span>POS z</span>
        <span><Leaf select={selectZ} /></span>
      </div>
      <div className="move-readout__row">
        <span>SPEED m/s</span>
        <span><Leaf select={selectSpeed} /></span>
      </div>
      <div className="move-readout__row">
        <span>DIST m</span>
        <span><Leaf select={selectDistance} /></span>
      </div>
      <div className="move-readout__row">
        <span>POINTER</span>
        <span ref={lockRef}>—</span>
      </div>
      <div className="move-readout__row">
        <span>MOUSE Δ</span>
        <span ref={mouseRef}>0, 0</span>
      </div>
      <div className="move-readout__keys">
        {KEY_CHIPS.map((chip) => (
          <span
            key={chip.label}
            className="move-readout__key"
            ref={(el) => {
              if (el) chipRefs.current.set(chip.label, el);
              else chipRefs.current.delete(chip.label);
            }}
          >
            {chip.label}
          </span>
        ))}
      </div>
    </div>
  );
}

