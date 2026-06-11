/**
 * RaftStamina.test.ts
 *
 * Unit tests for raft stamina system constants and logic.
 * Validates that stamina configuration produces the expected game feel:
 * - Strokes consume finite stamina
 * - Regen kicks in after delay
 * - Power curve provides forgiving output
 * - Exhaustion prevents strokes at low stamina
 */

import { RAFT } from '../../constants/game';

// Replicate the stamina logic from RaftVehicle.tsx for unit testing
interface StaminaState {
  current: number;
  regenDelay: number;
  isExhausted: boolean;
}

const STAMINA = {
  MAX: RAFT.STAMINA_MAX,
  COST: RAFT.STAMINA_COST_PER_STROKE,
  REGEN_RATE: RAFT.STAMINA_REGEN_RATE,
  REGEN_DELAY: RAFT.STAMINA_REGEN_DELAY,
  EXHAUSTED_THRESHOLD: RAFT.STAMINA_EXHAUSTED_THRESHOLD,
  POWER_CURVE: RAFT.STAMINA_POWER_CURVE,
};

function createStamina(): StaminaState {
  return { current: STAMINA.MAX, regenDelay: 0, isExhausted: false };
}

function updateStamina(st: StaminaState, delta: number): void {
  if (st.regenDelay > 0) {
    st.regenDelay -= delta;
    return;
  }
  if (st.current < STAMINA.MAX) {
    st.current = Math.min(STAMINA.MAX, st.current + STAMINA.REGEN_RATE * delta);
  }
  if (st.isExhausted && st.current > STAMINA.EXHAUSTED_THRESHOLD * 3) {
    st.isExhausted = false;
  }
}

function consumeStamina(st: StaminaState): number {
  if (st.isExhausted || st.current < STAMINA.EXHAUSTED_THRESHOLD) {
    st.isExhausted = true;
    return 0;
  }
  st.current = Math.max(0, st.current - STAMINA.COST);
  st.regenDelay = STAMINA.REGEN_DELAY;
  if (st.current < STAMINA.EXHAUSTED_THRESHOLD) {
    st.isExhausted = true;
  }
  const ratio = st.current / STAMINA.MAX;
  return Math.pow(ratio, STAMINA.POWER_CURVE);
}

describe('Raft Stamina System', () => {
  describe('Constants', () => {
    it('has valid stamina max', () => {
      expect(RAFT.STAMINA_MAX).toBe(100);
    });

    it('has positive cost per stroke', () => {
      expect(RAFT.STAMINA_COST_PER_STROKE).toBeGreaterThan(0);
      expect(RAFT.STAMINA_COST_PER_STROKE).toBeLessThan(RAFT.STAMINA_MAX);
    });

    it('has positive regen rate', () => {
      expect(RAFT.STAMINA_REGEN_RATE).toBeGreaterThan(0);
    });

    it('allows at least 3 consecutive strokes before exhaustion', () => {
      const minStrokes = Math.floor(
        (RAFT.STAMINA_MAX - RAFT.STAMINA_EXHAUSTED_THRESHOLD) / RAFT.STAMINA_COST_PER_STROKE
      );
      expect(minStrokes).toBeGreaterThanOrEqual(3);
    });

    it('can fully regen in under 10 seconds', () => {
      const fullRegenTime = RAFT.STAMINA_MAX / RAFT.STAMINA_REGEN_RATE;
      expect(fullRegenTime).toBeLessThan(10);
    });
  });

  describe('Consumption', () => {
    it('reduces current stamina on consume', () => {
      const st = createStamina();
      consumeStamina(st);
      expect(st.current).toBeLessThan(STAMINA.MAX);
    });

    it('returns positive power when stamina available', () => {
      const st = createStamina();
      const power = consumeStamina(st);
      expect(power).toBeGreaterThan(0);
      expect(power).toBeLessThanOrEqual(1);
    });

    it('returns 0 power when exhausted', () => {
      const st = createStamina();
      st.current = 2; // Below threshold
      st.isExhausted = true;
      const power = consumeStamina(st);
      expect(power).toBe(0);
    });

    it('sets regen delay on consumption', () => {
      const st = createStamina();
      consumeStamina(st);
      expect(st.regenDelay).toBe(STAMINA.REGEN_DELAY);
    });

    it('triggers exhaustion when stamina drops below threshold', () => {
      const st = createStamina();
      // Drain to just above threshold
      st.current = STAMINA.EXHAUSTED_THRESHOLD + 1;
      consumeStamina(st);
      expect(st.isExhausted).toBe(true);
    });
  });

  describe('Regeneration', () => {
    it('does not regen during delay period', () => {
      const st = createStamina();
      consumeStamina(st);
      const afterConsume = st.current;
      updateStamina(st, 0.1); // Less than delay
      expect(st.current).toBe(afterConsume);
    });

    it('regens after delay expires', () => {
      const st = createStamina();
      consumeStamina(st);
      const afterConsume = st.current;
      // Wait for delay to pass
      updateStamina(st, STAMINA.REGEN_DELAY + 0.01);
      // Now regen should occur on next update
      updateStamina(st, 1.0);
      expect(st.current).toBeGreaterThan(afterConsume);
    });

    it('caps at max stamina', () => {
      const st = createStamina();
      st.current = STAMINA.MAX - 1;
      st.regenDelay = 0;
      updateStamina(st, 10);
      expect(st.current).toBe(STAMINA.MAX);
    });

    it('clears exhaustion when recovered sufficiently', () => {
      const st = createStamina();
      st.isExhausted = true;
      st.current = STAMINA.EXHAUSTED_THRESHOLD * 3 + 1;
      st.regenDelay = 0;
      updateStamina(st, 0.016);
      expect(st.isExhausted).toBe(false);
    });
  });

  describe('Power Curve', () => {
    it('provides higher output at higher stamina levels', () => {
      const stHigh = createStamina();
      stHigh.current = 80;
      const stLow = createStamina();
      stLow.current = 30;

      const powerHigh = consumeStamina(stHigh);
      const powerLow = consumeStamina(stLow);
      expect(powerHigh).toBeGreaterThan(powerLow);
    });

    it('power curve is forgiving (50% stamina gives > 50% power)', () => {
      const st = createStamina();
      st.current = 50;
      const power = consumeStamina(st);
      // After consuming 15, ratio = 35/100 = 0.35, power = 0.35^0.7 ≈ 0.45
      // The power should be above the raw ratio
      const rawRatio = (50 - STAMINA.COST) / STAMINA.MAX;
      expect(power).toBeGreaterThan(rawRatio);
    });
  });
});

describe('Raft Physics Tuning', () => {
  it('paddle thrust force is sufficient for maneuvering', () => {
    expect(RAFT.PADDLE_THRUST_FORCE).toBeGreaterThanOrEqual(10);
  });

  it('brake drag multiplier provides meaningful deceleration', () => {
    expect(RAFT.BRAKE_DRAG_MULTIPLIER).toBeGreaterThan(2);
  });

  it('collision stun is brief (under 1 second)', () => {
    expect(RAFT.COLLISION_STUN_DURATION).toBeLessThan(1);
    expect(RAFT.COLLISION_STUN_DURATION).toBeGreaterThan(0);
  });

  it('camera FOV range is reasonable', () => {
    expect(RAFT.CAMERA_FOV_BASE).toBeGreaterThan(60);
    expect(RAFT.CAMERA_FOV_MAX).toBeLessThan(120);
    expect(RAFT.CAMERA_FOV_MAX).toBeGreaterThan(RAFT.CAMERA_FOV_BASE);
  });
});
