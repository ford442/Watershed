/**
 * RunnerStamina.test.ts
 *
 * Unit tests for runner sprint stamina constants and logic.
 * Validates the drain/recovery/hysteresis rules introduced alongside
 * the Zustand-backed sprintStamina field.
 */

// Mirror the RUNNER_SPRINT constants from RunnerVehicle.tsx so tests
// stay independent of the React component (no R3F / Rapier mocks needed).
const RUNNER_SPRINT = {
  DRAIN_RATE: 0.25,
  REGEN_GROUNDED: 0.15,
  REGEN_AIRBORNE: 0.30,
  EXHAUSTION_THRESHOLD: 0.0,
  RECOVERY_THRESHOLD: 0.2,
  SPEED_MULTIPLIER: 1.5,
} as const;

// Minimal stamina logic mirroring the useFrame implementation
interface RunnerStaminaState {
  stamina: number;
  sprintLocked: boolean;
}

function createState(): RunnerStaminaState {
  return { stamina: 1.0, sprintLocked: false };
}

/**
 * One-frame update matching the RunnerVehicle useFrame logic.
 * @param st   Mutable stamina state
 * @param dt   Delta time (seconds)
 * @param sprintInput  Raw sprint button state
 * @param isAirborne   Whether the player is currently airborne
 * @returns    Effective isSprinting value for this frame
 */
function updateStamina(
  st: RunnerStaminaState,
  dt: number,
  sprintInput: boolean,
  isAirborne: boolean
): boolean {
  // Hysteresis
  if (st.stamina <= RUNNER_SPRINT.EXHAUSTION_THRESHOLD) {
    st.sprintLocked = true;
  } else if (st.sprintLocked && st.stamina >= RUNNER_SPRINT.RECOVERY_THRESHOLD) {
    st.sprintLocked = false;
  }

  const isSprinting = sprintInput && !st.sprintLocked && !isAirborne;

  if (isSprinting) {
    st.stamina = Math.max(0, st.stamina - RUNNER_SPRINT.DRAIN_RATE * dt);
  } else if (isAirborne) {
    st.stamina = Math.min(1, st.stamina + RUNNER_SPRINT.REGEN_AIRBORNE * dt);
  } else {
    st.stamina = Math.min(1, st.stamina + RUNNER_SPRINT.REGEN_GROUNDED * dt);
  }

  return isSprinting;
}

describe('RunnerSprint constants', () => {
  it('drain rate is positive and less than 1/s', () => {
    expect(RUNNER_SPRINT.DRAIN_RATE).toBeGreaterThan(0);
    expect(RUNNER_SPRINT.DRAIN_RATE).toBeLessThan(1);
  });

  it('airborne regen is faster than grounded regen', () => {
    expect(RUNNER_SPRINT.REGEN_AIRBORNE).toBeGreaterThan(RUNNER_SPRINT.REGEN_GROUNDED);
  });

  it('recovery threshold is above exhaustion threshold', () => {
    expect(RUNNER_SPRINT.RECOVERY_THRESHOLD).toBeGreaterThan(RUNNER_SPRINT.EXHAUSTION_THRESHOLD);
  });

  it('speed multiplier is greater than 1', () => {
    expect(RUNNER_SPRINT.SPEED_MULTIPLIER).toBeGreaterThan(1);
  });

  it('can sustain sprint for at least 2 seconds from full stamina', () => {
    const secondsOfSprint = 1.0 / RUNNER_SPRINT.DRAIN_RATE;
    expect(secondsOfSprint).toBeGreaterThanOrEqual(2);
  });
});

describe('RunnerSprint drain / recovery', () => {
  it('drains stamina while sprinting grounded', () => {
    const st = createState();
    updateStamina(st, 1.0, true, false);
    expect(st.stamina).toBeCloseTo(1.0 - RUNNER_SPRINT.DRAIN_RATE * 1.0, 5);
  });

  it('recovers stamina at grounded rate when not sprinting', () => {
    const st = createState();
    st.stamina = 0.5;
    updateStamina(st, 1.0, false, false);
    expect(st.stamina).toBeCloseTo(0.5 + RUNNER_SPRINT.REGEN_GROUNDED * 1.0, 5);
  });

  it('recovers stamina at airborne rate when airborne', () => {
    const st = createState();
    st.stamina = 0.5;
    updateStamina(st, 1.0, false, true);
    expect(st.stamina).toBeCloseTo(0.5 + RUNNER_SPRINT.REGEN_AIRBORNE * 1.0, 5);
  });

  it('does NOT drain while airborne even with sprint held', () => {
    const st = createState();
    st.stamina = 0.5; // Not at cap so we can detect regen
    const isSprinting = updateStamina(st, 0.5, true, true);
    expect(isSprinting).toBe(false);
    // Stamina should increase (airborne regen), not decrease
    expect(st.stamina).toBeGreaterThan(0.5);
  });

  it('clamps stamina at 0 when fully drained', () => {
    const st = createState();
    st.stamina = 0.1;
    // Drain until sprint gets locked out (hysteresis), then stop
    while (st.stamina > 0 && !st.sprintLocked) {
      updateStamina(st, 0.016, true, false);
    }
    // One more frame so hysteresis runs and sets sprintLocked
    updateStamina(st, 0.016, true, false);
    expect(st.stamina).toBeCloseTo(0, 2);
  });

  it('clamps stamina at 1.0 when fully recovered', () => {
    const st = createState();
    st.stamina = 0.95;
    for (let i = 0; i < 20; i++) {
      updateStamina(st, 0.1, false, false);
    }
    expect(st.stamina).toBe(1.0);
  });
});

describe('RunnerSprint hysteresis', () => {
  it('locks sprint when stamina reaches 0', () => {
    const st = createState();
    st.stamina = 0;
    const isSprinting = updateStamina(st, 0.016, true, false);
    expect(st.sprintLocked).toBe(true);
    expect(isSprinting).toBe(false);
  });

  it('does not unlock sprint until RECOVERY_THRESHOLD is reached', () => {
    const st = createState();
    st.stamina = 0;
    st.sprintLocked = true;
    // Partial recovery — below threshold
    st.stamina = RUNNER_SPRINT.RECOVERY_THRESHOLD - 0.01;
    updateStamina(st, 0.016, false, false);
    expect(st.sprintLocked).toBe(true);
  });

  it('unlocks sprint once RECOVERY_THRESHOLD is reached', () => {
    const st = createState();
    st.sprintLocked = true;
    st.stamina = RUNNER_SPRINT.RECOVERY_THRESHOLD + 0.01;
    updateStamina(st, 0.016, false, false);
    expect(st.sprintLocked).toBe(false);
  });

  it('sprint remains locked at exactly RECOVERY_THRESHOLD boundary (exclusive lower)', () => {
    const st = createState();
    st.sprintLocked = true;
    st.stamina = RUNNER_SPRINT.RECOVERY_THRESHOLD - 0.001;
    updateStamina(st, 0.001, false, false);
    // stamina still below threshold after tiny recovery — must still be locked
    expect(st.sprintLocked).toBe(true);
  });

  it('full drain→recover cycle re-enables sprint', () => {
    const st = createState();
    // Drain to exhaustion (loop until sprintLocked, then do one final frame to confirm lock)
    while (st.stamina > 0 && !st.sprintLocked) {
      updateStamina(st, 0.016, true, false);
    }
    // One more frame so hysteresis check runs with stamina=0
    updateStamina(st, 0.016, false, false);
    expect(st.sprintLocked).toBe(true);

    // Recover beyond threshold (airborne for speed)
    while (st.stamina < RUNNER_SPRINT.RECOVERY_THRESHOLD + 0.05) {
      updateStamina(st, 0.016, false, true);
    }
    // One more frame to flip the lock
    updateStamina(st, 0.016, false, false);
    expect(st.sprintLocked).toBe(false);
  });
});
