import { VEHICLE_TUNING } from '../../constants/vehicleTuning';

export const RAYCAST_ORIGIN_OFFSET = 0.5;
export const RAYCAST_DISTANCE = 5.0;
export const SMOOTHING_FACTOR = 5.0;
export const DEG_TO_RAD = Math.PI / 180;

// Jump state machine configuration
export const JUMP_CONFIG = {
  FORCE: VEHICLE_TUNING.jumpForce,
  DOUBLE_JUMP_FORCE: VEHICLE_TUNING.doubleJumpForce,
  COMMIT_DURATION: 0.1,      // 0.1s strafe disable on jump
  RECOVERY_DURATION: 0.3,    // 0.3s recovery after landing
  HIGH_IMPACT_THRESHOLD: 5,  // units/s vertical velocity for camera shake
  GROUND_CHECK_DIST: 1.5,
  /** Forward impulse fraction added per unit of sin(slopeAngle) on downhill jumps */
  SLOPE_FORWARD_BIAS: 0.45,
  /** Consecutive ungrounded frames required before switching to airborne (smooths bumpy surfaces) */
  GROUNDED_HYSTERESIS_FRAMES: 3,
};

// Acceleration multipliers based on slope angle
export const SLOPE_RANGES = {
  FLAT: { max: 15, multiplier: 1.0 },
  GENTLE_DOWNSLOPE: { min: 15, max: 45, minMult: 1.0, maxMult: 1.5 },
  STEEP_DOWNSLOPE: { min: 45, max: 90, multiplier: 1.5 },
  UPSLOPE: { min: -45, max: 0, minMult: 0.6, maxMult: 0.8 },
  STEEP_UPSLOPE: { min: -90, max: -45, multiplier: 0.6 },
};

// Canyon bank riding configuration
export const BANK_CONFIG = {
  /** Lateral bank angle (°) above which assist forces engage */
  ASSIST_THRESHOLD: 20,
  /** Strength of the per-frame "plant" impulse that keeps the player on the bank face */
  ASSIST_STRENGTH: 22.0,
  /** Full-assist bank angle (°) – force is linearly interpolated from threshold to here */
  MAX_BANK_DEG: 70,
  /** Speed scaling coefficient: plant force grows with velocity (prevents flying off at speed) */
  SPEED_ASSIST_SCALE: 0.08,
  /** Anti-roll torque factor applied against X/Z angular velocity on steep banks */
  ANTI_ROLL_STRENGTH: 6.0,
  /** Additive speed-multiplier bonus at full bank (gravity-assist on steep canyon walls) */
  BANK_SPEED_BONUS: 0.3,
  /** Bank angle (°) at which the jump kick-off XZ bias reaches its maximum (0.5× jump force) */
  KICKOFF_MAX_BANK_DEG: 60,
  /** Multiplier applied to SLIDE_FRICTION on steep banks to allow smooth wall-riding */
  BANK_FRICTION_MULTIPLIER: 2,
};

export const NEAR_MISS_SPEED_THRESHOLD = 12;
export const NEAR_MISS_RAY_LENGTH = 2.6;
export const NEAR_MISS_TOI_MIN = 0.35;
export const NEAR_MISS_TOI_MAX = 1.55;

// Sprint stamina configuration (normalized 0.0–1.0)
export const RUNNER_SPRINT = {
  /** Stamina drained per second while sprinting on the ground */
  DRAIN_RATE: 0.25,
  /** Stamina recovered per second while grounded and NOT sprinting */
  REGEN_GROUNDED: 0.15,
  /** Stamina recovered per second while airborne (faster — rewarded air time) */
  REGEN_AIRBORNE: 0.30,
  /** Below this value sprint input is rejected (exhaustion lock) */
  EXHAUSTION_THRESHOLD: 0.0,
  /** Sprint re-enables once stamina reaches this level (hysteresis) */
  RECOVERY_THRESHOLD: 0.2,
  /** Speed multiplier while sprinting */
  SPEED_MULTIPLIER: 1.5,
} as const;

// Jump states
export type JumpState = 'grounded' | 'airborne' | 'landing' | 'recovering';

// Dodge states
export type DodgeState = 'ready' | 'dodging' | 'cooldown';

export interface DebugImpulse {
  tag: string;
  at: number;
  impulse: { x: number; y: number; z: number };
}

export interface DebugContact {
  at: number;
  point: { x: number; y: number; z: number };
}

export interface PhysicsDebugSnapshot {
  position: { x: number; y: number; z: number };
  linearVelocity: { x: number; y: number; z: number };
  angularVelocity: { x: number; y: number; z: number };
  speed: number;
  slopeAngle: number;
  bankAngle: number;
  isGrounded: boolean;
  jumpState: JumpState;
  friction: number;
  waterfallGravityMultiplier: number;
  effectiveG: number;
  extraGravity: number;
  currentSegmentIndex: number;
  groundRay: {
    origin: { x: number; y: number; z: number };
    hitPoint: { x: number; y: number; z: number } | null;
    distance: number | null;
  };
  groundNormal: { x: number; y: number; z: number };
  recentImpulses: DebugImpulse[];
  recentContacts: DebugContact[];
}
