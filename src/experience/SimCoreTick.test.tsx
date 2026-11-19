import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DebugStageController } from '../debug/debugStages';
import { simCore } from '../sim/core/SimCore';
import { SimCoreTick } from './SimCoreTick';

vi.mock('@react-three/fiber', () => ({ useFrame: () => undefined }));

/** A controller as useDebugStages returns one: a new object per stage report, the same functions. */
function controller(isStageEnabled: DebugStageController['isStageEnabled'], setStageFailure: DebugStageController['setStageFailure']) {
  return { isStageEnabled, setStageFailure, stageRuntime: {} } as unknown as DebugStageController;
}

describe('SimCoreTick system registration (#578 A)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    simCore.resetForTests();
  });

  it('does not rebuild the systems when only a stage report changed the controller', () => {
    const register = vi.spyOn(simCore, 'register');
    const enabled = () => true;
    const fail = () => undefined;
    const vehicleRef = { current: null };
    const { rerender, unmount } = render(<SimCoreTick debug={controller(enabled, fail)} vehicleRef={vehicleRef} />);
    const first = register.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    // useDebugStages hands out a new object on every loading / success report.
    for (let i = 0; i < 5; i += 1) rerender(<SimCoreTick debug={controller(enabled, fail)} vehicleRef={vehicleRef} />);
    expect(register.mock.calls.length).toBe(first);
    // Toggling a stage (a new isStageEnabled) does rebuild them, with the new gate.
    rerender(<SimCoreTick debug={controller(() => false, fail)} vehicleRef={vehicleRef} />);
    expect(register.mock.calls.length).toBe(first * 2);
    unmount();
  });
});
