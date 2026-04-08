export const WATER_LEVEL = 0.5;
export const WALL_WATERLINE_Y = 13;

// =============================================================================
// SCIENTIFIC PHYSICS CONSTANTS (from Wolfram Alpha)
// =============================================================================

/** Fresh water density at typical temperatures (kg/m³) */
export const WATER_DENSITY = 1000;

/** Human body density - humans barely sink (kg/m³) */
export const HUMAN_DENSITY = 1038;

/** Air density at sea level, 15°C (kg/m³) */
export const AIR_DENSITY = 1.226;

/** Water dynamic viscosity at 25°C (Pa·s) */
export const WATER_VISCOSITY = 8.9e-4;

/** Gravitational acceleration (m/s²) */
export const GRAVITY = 9.80665;

export const PLAYER_SPAWN = {
    position: [0, -4, -10] as const,
    fallbackCamera: [0, 5, 10] as const,
};

export const GENERATION = {
    THRESHOLD: 150,
    MAX_ACTIVE_SEGMENTS: 7,
    POOL_SIZE: 10,
    RECYCLE_MARGIN: 70,
} as const;

export const PHYSICS = {
    GRAVITY: -20,
    RIVER_FLOW_FORCE: 14,
    WATER_IMPULSE_SCALE: 1,
    // Buoyancy: ρ_water * V_displaced * g = 1000 * 0.3 * 9.8 ≈ 2940 N (scaled for gameplay)
    RAFT_BUOYANCY: 2940,
    // Drag coefficient: ~0.47 for turbulent flow around blunt body
    RAFT_DRAG: 0.47,
} as const;

export const PLAYER = {
    SPEED: 5,
    JUMP_FORCE: 5,
    CAMERA_HEIGHT: 0.8,
} as const;

export const RAFT = {
    WATER_LEVEL: WATER_LEVEL,
    HEIGHT: 0.3,           // 0.3m raft height
    WIDTH: 2,              // 2m width  
    LENGTH: 3,             // 3m length
    VOLUME: 1.8,           // Total volume: 2 * 3 * 0.3 = 1.8 m³
    MASS: 150,             // Raft mass (kg) - gives slight positive buoyancy
    
    // Buoyancy: ρ_water * V_displaced * g = 1000 * 1.8 * 9.8 ≈ 17640 N max
    // Scaled for gameplay balance: 2940 N
    BUOYANCY_MAX_FORCE: 2940,
    
    // Drag coefficient: ~0.47 for turbulent flow around blunt body
    // Water drag is ~800x higher than air drag due to density ratio
    DRAG_COEFFICIENT: 0.47,
    
    // Cross-sectional area for drag calculation (m²)
    DRAG_AREA_FRONT: 0.6,  // HEIGHT * WIDTH = 0.3 * 2
    DRAG_AREA_SIDE: 0.9,   // HEIGHT * LENGTH = 0.3 * 3
    
    TURBULENCE_FREQ: 2.0,
    TURBULENCE_AMP: 0.15,
    TIP_THRESHOLD_SPEED: 3,
    TIP_SUBMERGE_THRESHOLD: 0.5,
    TIP_FORCE_MAGNITUDE: 8,
    ROTATION_DAMPING: 0.95,
    RIGHTING_THRESHOLD_DEG: 45,
    RIGHTING_TORQUE: 15,
    DANGER_THRESHOLD_DEG: 70,
    DANGER_TIME: 1.0,
    RESET_HEIGHT: 2,
    PADDLE_THRUST_FORCE: 12,
    PADDLE_TORQUE_FORCE: 8,
    PADDLE_FOAM_PARTICLE_COUNT: 8,
    PADDLE_FOAM_LIFETIME: 0.6,
} as const;

export const SHADERS = {
    WATER_COLOR: '#1a7b9c',
    WATER_DEEP_COLOR: '#0d4a5a',
    WATER_FOAM_COLOR: '#dff4ff',
    WATER_EDGE_COLOR: '#8be8ff',
    MOSS_COLOR: '#4a6b44',
    LICHEN_COLOR: '#7a9a78',
    SLOT_ROCK_BASE: '#a35f39',
    SLOT_ROCK_SHADOW: '#4c2314',
    SLOT_ROCK_RIM: '#e0a16a',
} as const;

export const FLOW_FORECAST_STATES = {
    NORMAL: 'Normal',
    HIGH_FLOW: 'HighFlow',
    FLOODED: 'Flooded',
} as const;

export type FlowForecastState = typeof FLOW_FORECAST_STATES[keyof typeof FLOW_FORECAST_STATES];
