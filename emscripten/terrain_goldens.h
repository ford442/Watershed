/**
 * terrain_goldens.h — terrain tile fixtures shared by the host smoke runner (#487).
 *
 * Three segments, one per cross-section family: a summer meander (open
 * canyon, rock noise, the visual grid), a slot canyon (slot profile, the
 * collision grid) and a glacial ice tube (tube fold, overhang). The same
 * fixtures and the same golden sums are mirrored in
 * src/terrain/__tests__/terrainFixtures.ts (TS mirror, `pnpm test`) and
 * emscripten/smoke_test.mjs (the WASM build). Regenerate all three
 * together, deliberately.
 */

#ifndef WATERSHED_TERRAIN_GOLDENS_H
#define WATERSHED_TERRAIN_GOLDENS_H

#include "terrain.h"

namespace terrain_goldens {

struct Fixture {
    const char* name;
    double pathLength;
    double canyonWidth;
    double waterWidth;
    int segmentsX;
    int segmentsZ;
    int profile;
    bool rockNoise;
    bool hasTube;
    double tubeCurl;
    double tubeCeiling;
    const float* channel;
    int channelCount;
};

/** Per-plane sums over the whole tile, and H at three probe vertices. */
struct Golden {
    double sumAbsX;
    double sumH;
    double sumBank;
    double sumSlopeX;
    double sumSlopeZ;
    double sumAbsSlopeX;
    int probe[3];
    double probeH[3];
};

// [left, right, corridor, floorDepth, floorWave, riffle, gravelBarSide, undercutSide, flowScale]
inline constexpr float kMeanderChannel[] = {
    7.4f, 6.6f, 4.9f, 0.55f, 0.06f, -0.4f, 1.f, -1.f, 0.95f,
    7.9f, 6.2f, 4.9f, 0.20f, -0.10f, 0.3f, 1.f, -1.f, 1.05f,
    6.8f, 7.3f, 4.9f, -0.10f, 0.12f, 0.8f, -1.f, 1.f, 1.14f,
    6.1f, 7.8f, 4.9f, 0.75f, 0.02f, -0.7f, -1.f, 1.f, 0.92f,
    7.0f, 7.0f, 4.9f, 0.40f, -0.05f, -0.1f, 1.f, -1.f, 0.99f,
};

inline constexpr float kSlotChannel[] = {
    4.6f, 3.9f, 3.2f, 1.10f, 0.08f, -0.6f, 1.f, -1.f, 0.93f,
    4.1f, 4.4f, 3.2f, 0.30f, -0.12f, 0.5f, -1.f, 1.f, 1.09f,
    3.9f, 4.8f, 3.2f, 1.40f, 0.15f, -1.0f, -1.f, 1.f, 0.88f,
    4.4f, 4.0f, 3.2f, -0.20f, 0.00f, 0.9f, 1.f, -1.f, 1.16f,
};

inline constexpr float kTubeChannel[] = {
    5.2f, 4.8f, 3.5f, 0.60f, 0.04f, -0.5f, 1.f, -1.f, 0.94f,
    4.6f, 5.4f, 3.5f, 0.10f, -0.08f, 0.6f, -1.f, 1.f, 1.11f,
    5.0f, 5.0f, 3.5f, 0.35f, 0.10f, 0.0f, 1.f, -1.f, 1.00f,
};

inline constexpr int kChannelCount(const float* /*unused*/, int floats) {
    return floats / TERRAIN_CHANNEL_STRIDE;
}

inline const Fixture kFixtures[] = {
    {"summer meander", 96.0, 35.0, 14.0, 40, 96, TERRAIN_PROFILE_OPEN, true, false, 0.0, 0.0,
     kMeanderChannel, kChannelCount(kMeanderChannel, sizeof(kMeanderChannel) / sizeof(float))},
    {"slot canyon (collision grid)", 110.0, 24.0, 8.0, 10, 27, TERRAIN_PROFILE_SLOT, false, false, 0.0, 0.0,
     kSlotChannel, kChannelCount(kSlotChannel, sizeof(kSlotChannel) / sizeof(float))},
    {"glacial ice tube", 90.0, 25.0, 10.0, 40, 90, TERRAIN_PROFILE_OPEN, true, true, 0.88, 9.5,
     kTubeChannel, kChannelCount(kTubeChannel, sizeof(kTubeChannel) / sizeof(float))},
};

inline constexpr int kFixtureCount = sizeof(kFixtures) / sizeof(kFixtures[0]);

/**
 * Goldens from the host build (-ffp-contract=off), relative tolerance 1e-5
 * (absolute floor 1e-4). Regenerate with
 *   WATERSHED_PRINT_TERRAIN_GOLDENS=1 emscripten/build-host/watershed_host_smoke
 */
inline constexpr Golden kGoldens[kFixtureCount] = {
    {35647.5, 19824.7554, 2423, -18.5166114, 17.8918346, 4612.35603, {1988, 1998, 2008}, {0.214000002, 2.5464499, 24.8384438}},
    {2016.00003, 7131.92271, 223, 56.1832751, 2.37521543, 1189.26743, {148, 151, 153}, {-1.05444443, 28.1923027, 51.628479}},
    {17952.578, 18642.1421, 2276, 0.349430895, 10.8422007, 3021.99134, {1865, 1848, 1883}, {-0.105999999, 9.47856712, 9.68077946}},
};

/** Wall shell: the summer meander's shell (1.5 × canyon width, 24 × len/2) and a slot shell. */
struct WallFixture {
    const char* name;
    WallShellParams params;
    double sum;
    int probe;
    double probeY;
};

inline const WallFixture kWallFixtures[] = {
    {"summer shell", {96.0, 52.5, 24, 48, TERRAIN_PROFILE_OPEN, 0.0, 7}, 23614.6625, 612, 15.238183},
    {"slot shell", {110.0, 22.08, 24, 55, TERRAIN_PROFILE_SLOT, 26.0, 21}, 29972.3319, 700, 21.0236168},
};

}  // namespace terrain_goldens

#endif  // WATERSHED_TERRAIN_GOLDENS_H
