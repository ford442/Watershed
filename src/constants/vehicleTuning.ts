/**
 * Vehicle Tuning Configuration
 *
 * Centralized tunable parameters for the vehicle physics pass.
 * Adjust these values to iterate on momentum, drifting, wall riding, and boost feel.
 */

export const VEHICLE_TUNING = {
  // ===========================================================================
  // 1. Momentum & General Feel
  // ===========================================================================
  linearDampingAir: 0.35,
  linearDampingWater: 2.2,
  angularDampingAir: 0.9,
  angularDampingWater: 2.5,

  /** How quickly damping interpolates when entering/leaving water */
  dampingLerpSpeed: 4.0,

  /** Y-position offset above WATER_LEVEL to be considered "in water" */
  waterLevelThreshold: 0.6,

  // ===========================================================================
  // 2. Drifting
  // ===========================================================================
  /** Minimum speed required to initiate drift physics */
  driftMinSpeed: 3.5,

  /** Base lateral force multiplier during drift (0 = no drift, 1 = very slippery) */
  driftFactor: 0.55,

  /** Additional drift intensity per unit of segment flowSpeed */
  driftFlowScale: 0.18,

  /** Torque assist (yaw) applied while drifting */
  driftTorqueScale: 2.0,

  /** Lateral velocity preserved during drift (higher = more slide) */
  driftLateralRetention: 0.92,

  // ===========================================================================
  // 3. Wall Friction / Wall Riding
  // ===========================================================================
  /** How far sideways to raycast for canyon walls */
  wallRayDistance: 3.5,

  /** Upward offset for wall ray origin (avoid ground hits) */
  wallRayOriginYOffset: 0.4,

  /** Base friction applied against lateral velocity when near a wall */
  wallFrictionBase: 0.85,

  /** Reduced friction multiplier when actively pressing toward the wall */
  wallFrictionBoost: 0.35,

  /** Forward impulse applied during a successful wall-boost */
  wallBoostImpulse: 9.0,

  /** Minimum speed required to trigger a wall boost */
  wallBoostMinSpeed: 4.5,

  /** Cooldown between wall boosts (seconds) */
  wallBoostCooldown: 1.2,

  /** Small upward lift during wall contact to prevent submarining */
  wallLiftForce: 2.5,

  // ===========================================================================
  // 4. Boost Mechanic
  // ===========================================================================
  boostKey: 'Space',

  /** Forward impulse scale applied each frame during boost */
  boostStrength: 55.0,

  /** How long the active boost force is applied (seconds) */
  boostDuration: 0.4,

  /** Cooldown between boosts (seconds) */
  boostCooldown: 3.5,

  /** Linear damping multiplier while boosting (< 1 = less drag) */
  boostDampingMultiplier: 0.5,

  /** Angular damping multiplier while boosting */
  boostAngularDampingMultiplier: 0.6,

  /** Post-processing / shader event intensity */
  boostVisualIntensity: 1.6,

  /** Post-processing / shader event duration */
  boostVisualDuration: 0.9,

  // ===========================================================================
  // 5. Safety / Limits
  // ===========================================================================
  /** Hard linear velocity cap to prevent physics explosions */
  maxSpeedCap: 32.0,

  /** If true, applies a small downstream-alignment force at high speed */
  autoAlignToFlow: true,

  /** Strength of the auto-alignment torque */
  autoAlignTorque: 1.2,
} as const;

export type VehicleTuningConfig = typeof VEHICLE_TUNING;
