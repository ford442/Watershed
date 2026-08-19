/**
 * forces.cpp — water-force math (buoyancy, drag, flow, turbulence).
 *
 * Every function here is mirrored by a pure-TypeScript fallback in
 * src/systems/water/WatershedWasm.ts (`*Fallback`), and the two are held to an
 * epsilon by the parity tests in src/physics/__tests__/waterForceParity.test.ts.
 * Change one, change the other.
 */

#include "forces.h"

#include <cmath>
#include <algorithm>

// ---------------------------------------------------------------------------
// 1. Buoyancy  —  Archimedes' principle
//    F_b = ρ_water × V_displaced × g
//
//    @param submergedVolume  Volume of object below the waterline (m³)
//    @param waterDensity     Fluid density (kg/m³) — pass WATER_DENSITY_DEFAULT
//    @param gravity          Gravitational acceleration (m/s²) — pass GRAVITY_DEFAULT
//    @returns Upward buoyancy force (N)
// ---------------------------------------------------------------------------
float computeBuoyancy(float submergedVolume,
                      float waterDensity,
                      float gravity) noexcept {
    if (submergedVolume <= 0.f) return 0.f;
    return waterDensity * submergedVolume * gravity;
}

// ---------------------------------------------------------------------------
// 2. Drag Force  —  F_d = ½ · ρ · |v|² · C_d · A
//
//    @param vx, vy, vz  Object velocity vector (m/s)
//    @param cd          Drag coefficient (dimensionless; raft ≈ 0.47)
//    @param area        Cross-sectional area facing flow (m²)
//    @param density     Fluid density (kg/m³) — pass WATER_DENSITY_DEFAULT or AIR density
//    @returns Drag force magnitude (N)
// ---------------------------------------------------------------------------
float computeDragForce(float vx, float vy, float vz,
                       float cd, float area, float density) noexcept {
    const float speedSq = vx*vx + vy*vy + vz*vz;
    if (speedSq <= 0.f) return 0.f;
    return 0.5f * density * speedSq * cd * area;
}

// ---------------------------------------------------------------------------
// Browser smoke-test helper.
//
// Returns a single positive scalar that combines upward buoyancy and horizontal
// current drag. This is intentionally small and stable so the TypeScript side
// can prove C++ -> WASM -> browser wiring before deeper fluid math lands.
// ---------------------------------------------------------------------------
extern "C" WATERSHED_KEEPALIVE
float calculateBuoyancyAndDrag(float raftMass,
                               float submergedVolume,
                               float waterVelocityX,
                               float waterVelocityZ) noexcept {
    const float buoyancy = computeBuoyancy(
        submergedVolume,
        WATER_DENSITY_DEFAULT,
        GRAVITY_DEFAULT
    );
    const float waterSpeedSq = waterVelocityX * waterVelocityX + waterVelocityZ * waterVelocityZ;
    const float projectedArea = 1.8f;
    const float drag = 0.5f * WATER_DENSITY_DEFAULT * waterSpeedSq * 0.47f * projectedArea;
    const float weight = std::max(0.f, raftMass) * GRAVITY_DEFAULT;
    return std::max(0.f, buoyancy - weight) + drag;
}

// ---------------------------------------------------------------------------
// 3. Water Flow Force on a submerged object
//
//    Models river-current drag: the current pushes submerged objects
//    downstream using relative-velocity drag.
//    F = ½ · ρ_water · |v_rel|² · C_d · A · submergedRatio
//    applied along the relative-velocity direction.
//    Uses WATER_DENSITY_DEFAULT for the fluid density.
//
//    @param vx..vz          Object velocity (m/s)
//    @param fx..fz          Flow direction unit vector
//    @param flowSpeed       River speed magnitude (m/s)
//    @param mass            Object mass (kg)  [reserved for future inertial use]
//    @param submergedRatio  Fraction of object below waterline [0, 1]
//    @param cd              Drag coefficient
//    @param area            Cross-sectional area facing current (m²)
//    @returns Vec3 force (N) — add as impulse to the Rapier rigid body
// ---------------------------------------------------------------------------
Vec3 computeFlowForce(float vx, float vy, float vz,
                      float fx, float fy, float fz,
                      float flowSpeed,
                      float /*mass*/,
                      float submergedRatio,
                      float cd, float area) noexcept {
    // Relative velocity of object w.r.t. water current
    const float rwx = fx * flowSpeed - vx;
    const float rwy = fy * flowSpeed - vy;
    const float rwz = fz * flowSpeed - vz;

    const float speedSq = rwx*rwx + rwy*rwy + rwz*rwz;
    if (speedSq <= 0.f) return {};

    const float speed    = std::sqrt(speedSq);
    const float ratio    = clampf(submergedRatio, 0.f, 1.f);
    const float forceMag = 0.5f * WATER_DENSITY_DEFAULT * speedSq * cd * area * ratio;
    const float inv      = forceMag / speed;

    return { rwx * inv, rwy * inv, rwz * inv };
}

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
                                     float turbulenceFrequency) noexcept {
    WaterForceResult result;

    const float raftHeight = 0.35f;
    const float bottomY = posY - raftHeight * 0.5f;
    result.submergedRatio = clampf((waterLevel - bottomY) / raftHeight, 0.f, 1.f);
    if (result.submergedRatio <= 0.f) return result;

    const float displacedVolume = std::max(0.f, raftVolume) * result.submergedRatio;
    result.buoyancy = computeBuoyancy(displacedVolume, WATER_DENSITY_DEFAULT, GRAVITY_DEFAULT);
    const float weight = std::max(0.f, raftMass) * GRAVITY_DEFAULT;
    result.forceY += std::max(0.f, result.buoyancy - weight * 0.35f);

    float flowLen = std::sqrt(flowDirX * flowDirX + flowDirZ * flowDirZ);
    if (flowLen <= 0.0001f) {
        flowDirX = 0.f;
        flowDirZ = -1.f;
        flowLen = 1.f;
    }
    flowDirX /= flowLen;
    flowDirZ /= flowLen;

    const float relX = flowDirX * flowSpeed - velX;
    const float relZ = flowDirZ * flowSpeed - velZ;
    const float relSpeedSq = relX * relX + relZ * relZ;
    if (relSpeedSq > 0.000001f) {
        const float relSpeed = std::sqrt(relSpeedSq);
        const float projectedArea =
            frontalArea * std::abs(flowDirZ) +
            sideArea * std::abs(flowDirX);
        result.flow = 0.5f * WATER_DENSITY_DEFAULT * relSpeedSq *
            dragCoefficient * std::max(0.f, projectedArea) * result.submergedRatio;
        result.forceX += relX / relSpeed * result.flow;
        result.forceZ += relZ / relSpeed * result.flow;
    }

    const float speedSq = velX * velX + velY * velY + velZ * velZ;
    if (speedSq > 0.000001f) {
        const float speed = std::sqrt(speedSq);
        const float dragArea = frontalArea + sideArea * 0.35f;
        result.drag = 0.5f * WATER_DENSITY_DEFAULT * speedSq *
            dragCoefficient * std::max(0.f, dragArea) * result.submergedRatio;
        result.forceX -= velX / speed * result.drag;
        result.forceY -= velY / speed * result.drag * 0.2f;
        result.forceZ -= velZ / speed * result.drag;
    }

    if (turbulenceStrength > 0.f) {
        const float turbX = std::sin(timeSeconds * turbulenceFrequency + posZ * 0.37f);
        const float turbZ = std::cos(timeSeconds * turbulenceFrequency * 1.31f + posX * 0.29f);
        result.turbulence = turbulenceStrength * WATER_DENSITY_DEFAULT *
            result.submergedRatio;
        result.forceX += turbX * result.turbulence;
        result.forceZ += turbZ * result.turbulence;
    }

    return result;
}

// Batch ABI for workers — strides documented in common.h.
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
                             float turbulenceFrequency) noexcept {
    if (inputPtr == 0 || outputPtr == 0 || sampleCount <= 0) return;

    const float* input = reinterpret_cast<const float*>(inputPtr);
    float* output = reinterpret_cast<float*>(outputPtr);

    for (int i = 0; i < sampleCount; ++i) {
        const float* s = input + i * WATER_FORCE_INPUT_STRIDE;
        const WaterForceResult r = calculateWaterForce(
            s[0], s[1], s[2],
            s[3], s[4], s[5],
            s[6], s[7],
            flowSpeed,
            waterLevel,
            raftMass,
            raftVolume,
            dragCoefficient,
            frontalArea,
            sideArea,
            timeSeconds,
            turbulenceStrength,
            turbulenceFrequency
        );

        float* o = output + i * WATER_FORCE_OUTPUT_STRIDE;
        o[0] = r.forceX;
        o[1] = r.forceY;
        o[2] = r.forceZ;
        o[3] = r.buoyancy;
        o[4] = r.drag;
        o[5] = r.flow;
        o[6] = r.turbulence;
        o[7] = r.submergedRatio;
    }
}
