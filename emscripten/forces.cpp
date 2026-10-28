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
#include <cstddef>
#include <algorithm>
#include <span>

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
    if (inputPtr == 0 || outputPtr == 0 || sampleCount <= 0 || sampleCount > WATER_FORCE_MAX_SAMPLES) return;

    const std::size_t n = static_cast<std::size_t>(sampleCount);
    const std::span<const float> input = heapSpan<const float>(inputPtr, n * WATER_FORCE_INPUT_STRIDE);
    const std::span<float> output = heapSpan<float>(outputPtr, n * WATER_FORCE_OUTPUT_STRIDE);

    for (std::size_t i = 0; i < n; ++i) {
        const std::span<const float> s = input.subspan(i * WATER_FORCE_INPUT_STRIDE, WATER_FORCE_INPUT_STRIDE);
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

        const std::span<float> o = output.subspan(i * WATER_FORCE_OUTPUT_STRIDE, WATER_FORCE_OUTPUT_STRIDE);
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
