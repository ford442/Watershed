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

  /**
   * Per-frame impulse strength for player directional input.
   * Governs how quickly the player accelerates; works in conjunction with
   * linearDampingAir to determine effective top speed on flat terrain.
   * Increase to feel more responsive; decrease to feel heavier/floatier.
   */
  baseSpeed: 32,

  /**
   * River-current "pull" applied each frame along -Z (downstream) direction.
   * Higher values = stronger always-on downstream push.
   * Works with slopeMultiplier so steep sections feel faster automatically.
   */
  flowResponsiveness: 14,

  /**
   * Primary jump impulse magnitude (kg·m/s applied as a single frame impulse).
   * Tuned for PHYSICS.GRAVITY = -20; if gravity changes, scale proportionally.
   * Approximately sqrt(2 * |gravity| * desiredJumpHeight) * mass.
   */
  jumpForce: 44.9,

  /**
   * Double-jump impulse magnitude.  Slightly lower than jumpForce so the
   * second jump feels like a controlled boost rather than a full re-jump.
   */
  doubleJumpForce: 36.7,

  /**
   * Hard cap on horizontal speed (m/s) before the slope bonus is applied.
   * The effective cap on steep terrain = maxHorizontalSpeed * slopeMultiplier.
   * Prevents physics explosions on extreme slopes while still rewarding them.
   */
  maxHorizontalSpeed: 28.0,

  /**
   * How strongly slope multiplier raises the horizontal speed cap.
   * Effective max = maxHorizontalSpeed * (1 + slopeBonusScale * (mult - 1)).
   * At multiplier 1.5 (steepest slope) the cap rises by 50% of slopeBonusScale.
   */
  slopeBonusScale: 1.0,

  linearDampingAir: 0.35,
  linearDampingWater: 2.2,
  angularDampingAir: 0.9,
  angularDampingWater: 2.5,

  /** Reduced linear damping while the player is in shallow water.
   *  = linearDampingAir * 0.85 — slightly less drag in water to allow the
   *  current push to build speed without fighting the damping too hard.
   */
  linearDampingShallowWater: 0.35 * 0.85,

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

  // ===========================================================================
  // 6. Waterfall Launch-Shelf (segment 14)
  // ===========================================================================
  /** One-shot launch impulse when crossing the authored slab shelf on seg 14. */
  shelfLaunch: {
    /** Minimum downstream speed (m/s) required to trigger the launch. */
    speedThreshold: 12.0,

    /** Forward (-Z / downstream) impulse magnitude (kg·m/s).
     *  Tuned to carry the player off the waterfall drop and into the splash pool. */
    forwardMagnitude: 85.0,

    /** Upward (+Y) impulse magnitude (kg·m/s).
     *  Combined with forwardMagnitude to arc the player into segment 15. */
    upMagnitude: 65.0,

    /** Per-vehicle impulse scale. */
    runnerScale: 1.0,
    raftScale: 0.78,

    /** Trigger box half-extents (m). The box is centered on the shelf's
     *  downstream edge and aligned to the waterfall segment direction. */
    triggerHalfWidth: 9.0,
    triggerHalfLength: 7.0,
    triggerHeight: 6.0,

    /** Distance downstream from the shelf center to the trigger plane (m).
     *  Tuned for the seg-14 slab at localZ = -35, scale = 4.0. */
    triggerDownstreamOffset: 5.5,

    /** Vertical offset applied to the trigger center so it covers the shelf
     *  surface rather than the waterline. */
    triggerYOffset: 1.0,
  },
} as const;

export type VehicleTuningConfig = typeof VEHICLE_TUNING;
