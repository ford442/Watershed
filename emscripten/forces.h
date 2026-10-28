/**
 * forces.h — public declarations for water-force math.
 *
 * Implemented in forces.cpp. Host-clean — bindings.cpp includes this header
 * and exports the C ABI (ws_*) separately.
 */

#ifndef WATERSHED_FORCES_H
#define WATERSHED_FORCES_H

#include "common.h"
#include <cstdint>

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

/** Archimedes buoyancy: F_b = ρ · V_displaced · g (N). */
float computeBuoyancy(float submergedVolume,
                      float waterDensity,
                      float gravity) noexcept;

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

#endif  // WATERSHED_FORCES_H
