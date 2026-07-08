/**
 * emscripten/main.cpp — Watershed C++ WebAssembly Module
 *
 * Implements performance-critical water simulation and physics calculations
 * for the Watershed game using Emscripten + Embind.
 *
 * Exposed functions (via Embind):
 *   getVersion()
 *   calculateBuoyancyAndDrag(...)
 *   calculateWaterForce(...)
 *   computeWaterForcesBatch(...)
 *   computeBuoyancy(submergedVolume, waterDensity, gravity)
 *   computeDragForce(vx, vy, vz, cd, area, density)
 *   computeFlowForce(vx,vy,vz, fx,fy,fz, flowSpeed, mass, submergedRatio, cd, area) → Vec3
 *   stepShallowWater(hPtr, uPtr, wPtr, width, height, dt, g, dx, H)
 *   allocateGrid(count) → ptr
 *   freeGrid(ptr)
 *
 * Build:
 *   cd emscripten && ./build.sh
 *   (or) npm run build:wasm
 *
 * Output (placed in public/ so Vite serves them):
 *   public/watershed_native.js   — Emscripten glue + Embind
 *   public/watershed_native.wasm — WASM binary
 */

#include <emscripten/bind.h>
#include <emscripten/emscripten.h>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <algorithm>

// ---------------------------------------------------------------------------
// Compile-time constants
// ---------------------------------------------------------------------------
static constexpr float WATER_DENSITY_DEFAULT = 1000.0f;  // kg/m³  (fresh water)
static constexpr float GRAVITY_DEFAULT       = 9.80665f; // m/s² (standard gravity)
static constexpr float DAMPING_COEFF        = 0.1f;      // velocity damping per second

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
static inline float clampf(float v, float lo, float hi) noexcept {
    return v < lo ? lo : (v > hi ? hi : v);
}

// ---------------------------------------------------------------------------
// 3-component float vector (returned by computeFlowForce via Embind)
// ---------------------------------------------------------------------------
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
// Version / sanity check
// ---------------------------------------------------------------------------
/** Returns the module version integer (bump when ABI changes). */
int getVersion() noexcept {
    return 2;
}

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
extern "C" EMSCRIPTEN_KEEPALIVE
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

// Batch ABI for workers:
// input stride = 8 floats per raft/sample:
//   [posX, posY, posZ, velX, velY, velZ, flowDirX, flowDirZ]
// output stride = 8 floats per raft/sample:
//   [forceX, forceY, forceZ, buoyancy, drag, flow, turbulence, submergedRatio]
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
    constexpr int IN_STRIDE = 8;
    constexpr int OUT_STRIDE = 8;

    for (int i = 0; i < sampleCount; ++i) {
        const float* s = input + i * IN_STRIDE;
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

        float* o = output + i * OUT_STRIDE;
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

// ---------------------------------------------------------------------------
// 4. Shallow Water Equations (SWE) — linearised, one time step
//
//    Solves on a staggered Cartesian grid using forward differences:
//      ∂h/∂t = −H · (∂u/∂x + ∂w/∂z)
//      ∂u/∂t = −g · ∂h/∂x
//      ∂w/∂t = −g · ∂h/∂z
//
//    Grid layout: row-major, index = z * width + x
//      h[i]  — water height perturbation (m)
//      u[i]  — X-velocity component (m/s)
//      w[i]  — Z-velocity component (m/s)
//
//    All three arrays live in WASM linear memory; JS passes byte-offset
//    pointers obtained from allocateGrid().
//
//    @param hPtr   Heap pointer (byte offset) for height field
//    @param uPtr   Heap pointer (byte offset) for X-velocity field
//    @param wPtr   Heap pointer (byte offset) for Z-velocity field
//    @param width  Grid columns
//    @param height Grid rows
//    @param dt     Time step (s)  — internally clamped to CFL limit
//    @param g      Gravity (m/s²)
//    @param dx     Cell size (m)
//    @param H      Mean resting water depth (m) for linearisation
// ---------------------------------------------------------------------------
void stepShallowWater(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr,
                      int width, int height,
                      float dt, float g, float dx, float H) {
    if (width <= 0 || height <= 0 || dx <= 0.f || H <= 0.f) return;

    float* h = reinterpret_cast<float*>(hPtr);
    float* u = reinterpret_cast<float*>(uPtr);
    float* w = reinterpret_cast<float*>(wPtr);

    // Enforce CFL stability: dt ≤ dx / (c · √2),  c = √(g·H)
    const float waveSpeed = std::sqrt(g * H);
    const float cflMax    = dx / (waveSpeed * 1.5f);
    const float safeDt    = std::min(dt, cflMax);

    // --- Step 1: update velocities from pressure gradients ---
    for (int z = 0; z < height; ++z) {
        for (int x = 0; x < width; ++x) {
            const int idx = z * width + x;

            const float dhdx = (x < width  - 1) ? (h[idx + 1]     - h[idx]) / dx : 0.f;
            const float dhdz = (z < height - 1) ? (h[idx + width] - h[idx]) / dx : 0.f;

            u[idx] -= g * safeDt * dhdx;
            w[idx] -= g * safeDt * dhdz;
        }
    }

    // --- Step 2: update heights from velocity divergence ---
    for (int z = 0; z < height; ++z) {
        for (int x = 0; x < width; ++x) {
            const int idx = z * width + x;

            const float dudx = (x > 0) ? (u[idx] - u[idx - 1])     / dx : 0.f;
            const float dwdz = (z > 0) ? (w[idx] - w[idx - width])  / dx : 0.f;

            h[idx] -= H * safeDt * (dudx + dwdz);
        }
    }

    // --- Step 3: light velocity damping to prevent divergence ---
    const float damp = 1.f - safeDt * DAMPING_COEFF;
    const int N = width * height;
    for (int i = 0; i < N; ++i) {
        u[i] *= damp;
        w[i] *= damp;
    }
}

// ---------------------------------------------------------------------------
// 5. Grid memory helpers
//    Allocate / free Float32 arrays in WASM heap, addressable from JS via
//    Float32Array(module.HEAPF32.buffer, ptr, count).
// ---------------------------------------------------------------------------

/** Allocate `count` floats (zero-initialised) in WASM heap.
 *  Returns a byte-offset pointer suitable for use with HEAPF32.
 */
uintptr_t allocateGrid(int count) {
    if (count <= 0) return 0;
    void* ptr = std::calloc(static_cast<std::size_t>(count), sizeof(float));
    return reinterpret_cast<uintptr_t>(ptr);
}

/** Free a grid previously returned by allocateGrid. */
void freeGrid(uintptr_t ptr) {
    std::free(reinterpret_cast<void*>(ptr));
}

// ---------------------------------------------------------------------------
// Embind bindings
// ---------------------------------------------------------------------------
EMSCRIPTEN_BINDINGS(watershed_native) {
    emscripten::function("getVersion",       &getVersion);
    emscripten::function("calculateBuoyancyAndDrag", &calculateBuoyancyAndDrag);
    emscripten::function("calculateWaterForce", &calculateWaterForce);
    emscripten::function("computeWaterForcesBatch", &computeWaterForcesBatch);
    emscripten::function("computeBuoyancy",  &computeBuoyancy);
    emscripten::function("computeDragForce", &computeDragForce);
    emscripten::function("computeFlowForce", &computeFlowForce);
    emscripten::function("stepShallowWater", &stepShallowWater);
    emscripten::function("allocateGrid",     &allocateGrid);
    emscripten::function("freeGrid",         &freeGrid);

    emscripten::value_object<Vec3>("Vec3")
        .field("x", &Vec3::x)
        .field("y", &Vec3::y)
        .field("z", &Vec3::z);

    emscripten::value_object<WaterForceResult>("WaterForceResult")
        .field("forceX", &WaterForceResult::forceX)
        .field("forceY", &WaterForceResult::forceY)
        .field("forceZ", &WaterForceResult::forceZ)
        .field("buoyancy", &WaterForceResult::buoyancy)
        .field("drag", &WaterForceResult::drag)
        .field("flow", &WaterForceResult::flow)
        .field("turbulence", &WaterForceResult::turbulence)
        .field("submergedRatio", &WaterForceResult::submergedRatio);
}
