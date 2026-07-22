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
    /** Slightly above glacier riverbed (~Y -8) to reduce initial drop / penetration. */
    position: [0, -6, -10] as const,
    fallbackCamera: [0, -5.2, -10] as const,
};

export const GENERATION = {
    THRESHOLD: 150,
    MAX_ACTIVE_SEGMENTS: 7,
    POOL_SIZE: 10,
    RECYCLE_MARGIN: 70,
} as const;

export const REACH_API_BASE = '/api/reaches';

export const TRANSITION_SEGMENT_TYPES = ['waterfall', 'splash'] as const;

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
    /**
     * @deprecated  Movement speed is controlled by VEHICLE_TUNING.baseSpeed in
     *              src/constants/vehicleTuning.ts.  This value is not read by
     *              RunnerVehicle and is retained only for reference.
     */
    SPEED: 5,
    /**
     * @deprecated  Jump force is controlled by VEHICLE_TUNING.jumpForce in
     *              src/constants/vehicleTuning.ts.  This value is not read by
     *              RunnerVehicle and is retained only for reference.
     */
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
    PADDLE_THRUST_FORCE: 14,
    PADDLE_TORQUE_FORCE: 10,
    PADDLE_FOAM_PARTICLE_COUNT: 8,
    PADDLE_FOAM_LIFETIME: 0.6,

    // Stamina system for paddle strokes
    STAMINA_MAX: 100,
    STAMINA_COST_PER_STROKE: 15,
    STAMINA_REGEN_RATE: 20,        // per second
    STAMINA_REGEN_DELAY: 0.4,      // seconds before regen starts after stroke
    STAMINA_EXHAUSTED_THRESHOLD: 5, // below this, strokes are disabled
    STAMINA_POWER_CURVE: 0.7,      // at 50% stamina, force = 50%^0.7 ≈ 62% (feels forgiving)

    // Brake (broadside drag)
    BRAKE_DRAG_MULTIPLIER: 4.0,    // multiplier on drag when braking
    BRAKE_ANGULAR_DRAG: 6.0,       // extra angular damping when braking

    // Collision response
    COLLISION_BOUNCE_FORCE: 10,    // elastic bounce impulse scale (increased for satisfying wall pops)
    COLLISION_SPIN_FORCE: 4,       // spin applied on impact
    COLLISION_STUN_DURATION: 0.25, // base stun duration — scales up with impact force
    COLLISION_STUN_MAX: 0.6,       // cap on stun duration regardless of impact force
    COLLISION_WALL_FORWARD_RETAIN: 0.7, // fraction of forward momentum kept on lateral wall hit

    // Forward bias after a paddle stroke: keeps some momentum for this many seconds
    PADDLE_FORWARD_BIAS_DURATION: 0.35,
    PADDLE_FORWARD_BIAS_FORCE: 3.5,

    // Camera dynamics
    CAMERA_BASE_OFFSET_Y: 2.5,
    CAMERA_BASE_OFFSET_Z: 5.0,
    CAMERA_VELOCITY_LAG: 0.15,     // how much camera trails behind velocity
    CAMERA_LEAN_FACTOR: 0.3,       // lean into turns
    CAMERA_LERP_SPEED: 0.08,
    CAMERA_FOV_BASE: 75,
    CAMERA_FOV_SPEED_SCALE: 8,     // FOV increase at max speed
    CAMERA_FOV_MAX: 90,
    CAMERA_FOV_LERP: 0.05,
} as const;

export const SHADERS = {
    WATER_COLOR: '#1a7b9c',
    WATER_DEEP_COLOR: '#0d4a5a',
    WATER_FOAM_COLOR: '#dff4ff',
    WATER_EDGE_COLOR: '#8be8ff',
    MOSS_COLOR: '#2d471f',
    LICHEN_COLOR: '#7a9a78',
    SLOT_ROCK_BASE: '#a35f39',
    SLOT_ROCK_SHADOW: '#4c2314',
    SLOT_ROCK_RIM: '#e0a16a',
} as const;

export const ROCK_SHADER = {
    DISPLACEMENT_SCALE: 0.025,
    CRACK_INTENSITY: 0.35,
    CRACK_SCALE: 1.5,
    WETNESS_DARKEN: 0.30,
    WEATHER_WETNESS_BOOST: 0.55,
    STRATIFICATION_STRENGTH: 0.20,
    STRATIFICATION_SCALE: 0.40,
    COLOR_VARIATION_STRENGTH: 0.25,
    WARM_COLOR: '#8f4f3d',
    COOL_COLOR: '#788088',
    MAX_NOISE_OPS: 6,
} as const;

export const WATER_SHADER = {
    DISPLACEMENT_STRENGTH: 1.0,
    FOAM_INTENSITY: 1.0,
    RIPPLE_SCALE: 1.0,
    FLOW_INFLUENCE: 0.7,
    CAUSTICS_BRIGHTNESS: 0.5,
    WAKE_WIDTH: 1.2,
    WAKE_LENGTH: 4.0,
    EDGE_FOAM_WIDTH: 0.28,
    WETNESS_DARKEN: 0.25,
    WETNESS_REFLECT_BOOST: 0.3,
    // Rapids foam scrolls faster once flowSpeed pushes past this multiplier threshold
    RAPIDS_FOAM_SPEED_MULT: 1.8,
    // Canyon god-ray shaft strength (0 = off, 1 = full blinding shafts)
    GOD_RAY_STRENGTH: 0.0,
    // Sun/moon specular highlight tightness (higher = sharper glint)
    SPECULAR_SHININESS: 70.0,
    // Eddy/standing foam intensity in slow-moving water
    EDDY_FOAM_INTENSITY: 0.5,
    // Multiplier applied to displacement/foam/specular scale in glassy pond/delta water
    POND_CALM_MULTIPLIER: 0.35,
} as const;

export const FLOW_FORECAST_STATES = {
    NORMAL: 'Normal',
    HIGH_FLOW: 'HighFlow',
    FLOODED: 'Flooded',
    WASHED_OUT: 'WashedOut',
} as const;

export type FlowForecastState = typeof FLOW_FORECAST_STATES[keyof typeof FLOW_FORECAST_STATES];

// =============================================================================
// PLAYER MOVEMENT CONSTANTS (Goal 2)
// =============================================================================

export const MOVEMENT = {
    /** Grace period after leaving ground where jump still works (seconds) */
    COYOTE_TIME: 0.08,
    /** Multiplier applied to upward velocity when jump key is released early */
    JUMP_CUT_MULTIPLIER: 0.4,
    /** Lateral dodge impulse strength */
    DODGE_FORCE: 28,
    /** How long the dodge impulse lasts (seconds) */
    DODGE_DURATION: 0.25,
    /** Minimum time between dodges (seconds) */
    DODGE_COOLDOWN: 0.8,
    /** How long player is invulnerable during dodge (seconds) */
    DODGE_I_FRAMES: 0.15,
    /** Speed multiplier when sliding on steep downslope */
    SLIDE_SPEED_BOOST: 1.4,
    /** Reduced friction during slide */
    SLIDE_FRICTION: 0.02,
    /** Maximum slope angle (degrees) for slide activation */
    SLIDE_MIN_SLOPE: 35,
    /** Fraction of platform velocity transferred to the player */
    PLAYER_MOMENTUM_TRANSFER: 0.3,
} as const;

export const FLOATING_OBJECT = {
    /** Density of floating debris (kg/m³) — less than water = floats */
    DEBRIS_DENSITY: 600,
    /** Approximate volume of a debris piece (m³) */
    DEBRIS_VOLUME: 0.5,
    /** How much river current affects debris (0-1) */
    FLOW_INFLUENCE: 0.6,
    /** How much platform velocity transfers to player per frame */
    PLAYER_MOMENTUM_TRANSFER: 0.3,
    /** Max floating objects per active segment (performance budget) */
    MAX_PER_SEGMENT: 8,
    /** Drag coefficient for debris in water */
    DRAG_COEFFICIENT: 0.7,
    /** Cross-sectional area for drag (m²) */
    DRAG_AREA: 0.4,
} as const;
