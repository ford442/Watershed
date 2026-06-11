/**
 * Water Flow Physics Configuration
 *
 * Tunable parameters for the river current force system.
 */

export const WATER_FLOW_CONFIG = {
  /** Base multiplier for the downstream tangent force */
  baseFlowMultiplier: 2.4,

  /** Raft surface area used by the segment current impulse */
  raftSubmergedArea: 2.8,

  /** Fraction of current impulse retained after water sheds off the raft */
  raftDragShedding: 0.9,

  /** Segment flowSpeed at which current should feel neutral */
  raftNeutralFlowSpeed: 1.0,

  /** Extra carry in fast rapids and waterfall approaches */
  raftRapidsCarryMultiplier: 1.35,

  /** Mild resistance in ponds and splash pools */
  raftPondSlowMultiplier: 0.62,

  /** Extra multiplier in rapids sections (flowSpeed > 1.3) */
  rapidsMultiplier: 1.55,

  /** Extra multiplier in flooded sections */
  floodedMultiplier: 1.9,

  /** Reduced multiplier in calm pools/eddies (flowSpeed < 0.6) */
  poolMultiplier: 0.45,

  /** Lateral impulse strength from flowMap or centering force */
  lateralStrength: 0.35,

  /** How strongly turbulence pushes the vehicle around */
  turbulenceAmount: 1.4,

  /** Spatial frequency of the turbulence noise */
  turbulenceFrequency: 0.18,

  /** How much the current pulls the vehicle toward the river centerline */
  centeringStrength: 0.22,

  /** Small downward Y impulse to keep the vehicle seated in the water */
  downwardPull: 0.42,

  /** Minimum interval between flowMap CPU samples (seconds) */
  flowMapSampleInterval: 0.1,

  /** Threshold for dispatching high-flow audio/visual events */
  audioThreshold: 1.6,

  /** Distance cutoff for applying any water force */
  maxInfluenceDistance: 28,

  /** Torque applied when misaligned with current */
  alignmentTorque: 1.1,

  /** FlowMap bounds padding (multiplier on computed bounds) */
  boundsPadding: 1.05,
} as const;

export type WaterFlowConfig = typeof WATER_FLOW_CONFIG;
