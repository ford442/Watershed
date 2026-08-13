/**
 * watershed_native.h — shared declarations for the Watershed WASM module.
 *
 * Translation units:
 *   forces.cpp    — buoyancy, drag, flow, per-body and batched water forces
 *   swe.cpp       — shallow-water solver + WASM heap grid helpers
 *   bindings.cpp  — getVersion() + the Embind surface
 *
 * All compile/link flags live in CMakeLists.txt — build.sh is a thin wrapper.
 */

#ifndef WATERSHED_NATIVE_H
#define WATERSHED_NATIVE_H

#include <cstdint>

// ---------------------------------------------------------------------------
// Compile-time constants
// ---------------------------------------------------------------------------
static constexpr float WATER_DENSITY_DEFAULT = 1000.0f;  // kg/m³  (fresh water)
static constexpr float GRAVITY_DEFAULT       = 9.80665f; // m/s² (standard gravity)
static constexpr float DAMPING_COEFF         = 0.1f;     // velocity damping per second

/** Batch ABI stride, in floats. Mirrored by WATER_FORCE_*_STRIDE in WatershedWasm.ts. */
static constexpr int WATER_FORCE_INPUT_STRIDE  = 8;
static constexpr int WATER_FORCE_OUTPUT_STRIDE = 8;

// ---------------------------------------------------------------------------
// Value types crossing the Embind boundary
// ---------------------------------------------------------------------------

/** 3-component float vector (returned by computeFlowForce). */
struct Vec3 {
    float x = 0.f, y = 0.f, z = 0.f;
};

struct WaterForceResult {
    float forceX = 0.f;
    float forceY = 0.f;
    float forceZ = 0.f;
    float buoyancy = 0.f;
    float drag = 0.f;
    float flow = 0.f;
    float turbulence = 0.f;
    float submergedRatio = 0.f;
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
inline float clampf(float v, float lo, float hi) noexcept {
    return v < lo ? lo : (v > hi ? hi : v);
}

// ---------------------------------------------------------------------------
// bindings.cpp
// ---------------------------------------------------------------------------

/**
 * Module ABI version. Bump whenever the exported surface or a batch stride
 * changes; WatershedWasm.ts documents what each version added.
 */
int getVersion() noexcept;

// ---------------------------------------------------------------------------
// forces.cpp
// ---------------------------------------------------------------------------

/** Archimedes buoyancy: F_b = ρ · V_displaced · g (N). */
float computeBuoyancy(float submergedVolume,
                      float waterDensity,
                      float gravity) noexcept;

/** Drag magnitude: F_d = ½ · ρ · |v|² · C_d · A (N). */
float computeDragForce(float vx, float vy, float vz,
                       float cd, float area, float density) noexcept;

/** Browser smoke-test helper — combines upward buoyancy and current drag. */
extern "C" float calculateBuoyancyAndDrag(float raftMass,
                                          float submergedVolume,
                                          float waterVelocityX,
                                          float waterVelocityZ) noexcept;

/** River-current force on a partially submerged object, along relative velocity. */
Vec3 computeFlowForce(float vx, float vy, float vz,
                      float fx, float fy, float fz,
                      float flowSpeed,
                      float mass,
                      float submergedRatio,
                      float cd, float area) noexcept;

/** Full water-force solve for a single body (buoyancy + flow + drag + turbulence). */
WaterForceResult calculateWaterForce(float posX, float posY, float posZ,
                                     float velX, float velY, float velZ,
                                     float flowDirX, float flowDirZ,
                                     float flowSpeed,
                                     float waterLevel,
                                     float raftMass,
                                     float raftVolume,
                                     float dragCoefficient,
                                     float frontalArea,
                                     float sideArea,
                                     float timeSeconds,
                                     float turbulenceStrength,
                                     float turbulenceFrequency) noexcept;

/**
 * Batch ABI for workers.
 *   input  stride 8: [posX, posY, posZ, velX, velY, velZ, flowDirX, flowDirZ]
 *   output stride 8: [forceX, forceY, forceZ, buoyancy, drag, flow, turbulence, submergedRatio]
 */
void computeWaterForcesBatch(uintptr_t inputPtr,
                             uintptr_t outputPtr,
                             int sampleCount,
                             float flowSpeed,
                             float waterLevel,
                             float raftMass,
                             float raftVolume,
                             float dragCoefficient,
                             float frontalArea,
                             float sideArea,
                             float timeSeconds,
                             float turbulenceStrength,
                             float turbulenceFrequency) noexcept;

// ---------------------------------------------------------------------------
// swe.cpp
// ---------------------------------------------------------------------------

/** Advance the linearised shallow-water grid one CFL-clamped time step. */
void stepShallowWater(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr,
                      int width, int height,
                      float dt, float g, float dx, float H);

/** Allocate `count` zero-initialised floats in the WASM heap; returns a byte offset. */
uintptr_t allocateGrid(int count);

/** Free a pointer previously returned by allocateGrid. */
void freeGrid(uintptr_t ptr);

#endif  // WATERSHED_NATIVE_H
