import { beforeEach, describe, expect, it } from 'vitest';
import { TouchSource, TOUCH_LOOK_GAIN, type TouchTuning } from './TouchSource';
import { InputHub } from '../InputHub';
import { InputButton } from '../InputFrame';

function pointer(type: string, init: { id: number; x: number; y: number; target?: Element }) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.x, clientY: init.y }) as MouseEvent & { pointerId: number };
  Object.defineProperty(ev, 'pointerId', { value: init.id });
  (init.target ?? root).dispatchEvent(ev);
}

let root: HTMLDivElement;
let hub: InputHub;
let source: TouchSource;
let tuning: TouchTuning;

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  root.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 800, width: 400, height: 800, x: 0, y: 0, toJSON: () => ({}) });
  root.innerHTML = '<button data-touch="jump"></button><button data-touch="pause"></button><button data-touch="paddleL"></button><button data-touch="paddleR"></button>';
  document.body.appendChild(root);
  tuning = { leftHanded: false, deadzone: 0.12, radius: 60 };
  hub = new InputHub();
  source = new TouchSource(() => tuning);
  source.attach(root);
  hub.registerSource(source);
});

const tick = () => {
  hub.tick(1000 / 60, 1);
  return hub.readFrame();
};

describe('TouchSource', () => {
  it('a finger on the left half plants a floating stick: up is forward, right is right', () => {
    pointer('pointerdown', { id: 1, x: 150, y: 600 });
    pointer('pointermove', { id: 1, x: 210, y: 540 }); // right 60, up 60 = full radius
    const f = tick();
    expect(f.moveX).toBeGreaterThan(0.5);
    expect(f.moveY).toBeGreaterThan(0.5);
    expect(f.source).toBe('touch');
  });

  it('saturates at the radius and returns to neutral on release', () => {
    pointer('pointerdown', { id: 1, x: 150, y: 600 });
    pointer('pointermove', { id: 1, x: 150 + 500, y: 600 });
    const f = tick();
    expect(f.moveX).toBeCloseTo(1);
    pointer('pointerup', { id: 1, x: 650, y: 600 });
    expect(tick().moveX).toBe(0);
  });

  it('a small wobble inside the dead zone is nothing', () => {
    pointer('pointerdown', { id: 1, x: 150, y: 600 });
    pointer('pointermove', { id: 1, x: 154, y: 598 });
    expect(tick().moveX).toBe(0);
  });

  it('a drag on the right half is look, paid out once, with the touch gain', () => {
    pointer('pointerdown', { id: 2, x: 300, y: 400 });
    pointer('pointermove', { id: 2, x: 310, y: 405 });
    pointer('pointermove', { id: 2, x: 320, y: 410 });
    const f = tick();
    expect(f.lookDX).toBeCloseTo(20 * TOUCH_LOOK_GAIN);
    expect(f.lookDY).toBeCloseTo(10 * TOUCH_LOOK_GAIN);
    expect(f.source).toBe('touch');
    const again = tick();
    expect(again.lookDX).toBe(0);
  });

  it('stick and look work at the same time with two fingers', () => {
    pointer('pointerdown', { id: 1, x: 100, y: 600 });
    pointer('pointerdown', { id: 2, x: 300, y: 400 });
    pointer('pointermove', { id: 1, x: 100, y: 540 });
    pointer('pointermove', { id: 2, x: 330, y: 400 });
    const f = tick();
    expect(f.moveY).toBeGreaterThan(0.5);
    expect(f.lookDX).toBeGreaterThan(0);
  });

  it('left-handed play mirrors the halves', () => {
    tuning.leftHanded = true;
    pointer('pointerdown', { id: 1, x: 300, y: 600 }); // right half is now the stick
    pointer('pointermove', { id: 1, x: 300, y: 540 });
    expect(tick().moveY).toBeGreaterThan(0.5);
  });

  it('on-screen buttons set bits and release with their own pointer', () => {
    const jump = root.querySelector('[data-touch="jump"]')!;
    const pause = root.querySelector('[data-touch="pause"]')!;
    pointer('pointerdown', { id: 5, x: 350, y: 700, target: jump });
    pointer('pointerdown', { id: 6, x: 380, y: 20, target: pause });
    let b = tick().buttons;
    expect(b & InputButton.JUMP).toBeTruthy();
    expect(b & InputButton.PAUSE).toBeTruthy();
    pointer('pointerup', { id: 99, x: 0, y: 0 }); // some other finger lifting
    expect(tick().buttons & InputButton.JUMP).toBeTruthy();
    pointer('pointerup', { id: 5, x: 350, y: 700 });
    b = tick().buttons;
    expect(b & InputButton.JUMP).toBe(0);
    expect(b & InputButton.PAUSE).toBeTruthy();
  });

  it('paddle buttons drive paddleL / paddleR as 0 or 1', () => {
    pointer('pointerdown', { id: 7, x: 0, y: 0, target: root.querySelector('[data-touch="paddleL"]')! });
    const f = tick();
    expect(f.paddleL).toBe(1);
    expect(f.paddleR).toBe(0);
  });

  it('detach releases everything held', () => {
    pointer('pointerdown', { id: 1, x: 150, y: 600 });
    pointer('pointermove', { id: 1, x: 210, y: 600 });
    pointer('pointerdown', { id: 5, x: 0, y: 0, target: root.querySelector('[data-touch="jump"]')! });
    source.detach();
    const f = tick();
    expect(f.moveX).toBe(0);
    expect(f.buttons).toBe(0);
  });

  it('keeps the stick origin inside the layer padding', () => {
    root.style.paddingLeft = '40px';
    pointer('pointerdown', { id: 1, x: 5, y: 600 });
    const v = source.getStickVisual();
    expect(v.active).toBe(true);
    expect(v.originX).toBeGreaterThanOrEqual(40 + tuning.radius);
  });
});
