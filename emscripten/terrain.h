/**
 * terrain.h — one canyon source: a segment's floor as a tile of planes (#487, ABI 13).
 *
 * Today the canyon is an analytic U-profile that TypeScript evaluates three
 * times (visual floor, Rapier hull, SWE bed). This TU is that profile as one
 * pure function: path length + width + channel profile + tube profile in, SoA
 * planes out, at whatever grid resolution the caller asks for. The collision
 * and bed consumers ask for the same tile at a coarser grid (or without rock
 * noise); they never re-derive the formula.
 *
 * Grid convention — identical to three's PlaneGeometry(canyonWidth, pathLength,
 * segmentsX, segmentsZ) after rotateX(−π/2), which is what the TS builders used:
 *
 *     vertex i = iz * (segmentsX + 1) + ix
 *     x = ix · canyonWidth / segmentsX − canyonWidth / 2      (local, across)
 *     z = iz · pathLength / segmentsZ − pathLength / 2        (local, along)
 *     t = iz / segmentsZ                                      (path parameter)
 *
 * Planes (TERRAIN_TILE_PLANES floats per vertex, plane-major):
 *   X       local x after the tube fold (== grid x on open-sky segments)
 *   H       local floor height above the path point (the builders' `yHeight`)
 *   BANK    1 where the vertex is outside the wetted channel (|x| ≥ bank half-width), else 0
 *   SLOPE_X ∂H/∂x on the unfolded grid (central differences, one-sided at the edges)
 *   SLOPE_Z ∂H/∂z, same stencil
 *   UV_U    across-channel coordinate in [0, 1] (ix / segmentsX)
 *   UV_V    metres downstream from the segment start (t · pathLength)
 *
 * The channel profile is TERRAIN_CHANNEL_STRIDE floats per sample, field order
 * of ChannelProfileSample minus t / worldArc (the samples are evenly spaced in
 * t, as the TS generator emits them):
 *   [leftHalfWidth, rightHalfWidth, corridorHalfWidth, floorDepth, floorWave,
 *    riffleStrength, gravelBarSide (±1), undercutSide (±1), flowScale]
 *
 * Arithmetic is double internally and rounds once into the float planes, so
 * the TS mirror (src/terrain/terrainTile.ts, float64) agrees to ~1 ulp and the
 * host build and the -ffast-math WASM build agree with each other.
 *
 * Host-clean; bindings.cpp exports the C ABI (ws_buildTerrainTile / ws_buildWallShell).
 */

#ifndef WATERSHED_TERRAIN_H
#define WATERSHED_TERRAIN_H

#include "common.h"

#include <span>

/** Floats per channel-profile sample. Mirrored by TERRAIN_CHANNEL_STRIDE in terrainTile.ts. */
static constexpr int TERRAIN_CHANNEL_STRIDE = 9;

/** Planes per tile. Mirrored by TERRAIN_TILE_PLANES in terrainTile.ts. */
static constexpr int TERRAIN_TILE_PLANES = 7;

/** Plane order. Mirrored by TerrainPlane in terrainTile.ts. */
static constexpr int TERRAIN_PLANE_X = 0;
static constexpr int TERRAIN_PLANE_H = 1;
static constexpr int TERRAIN_PLANE_BANK = 2;
static constexpr int TERRAIN_PLANE_SLOPE_X = 3;
static constexpr int TERRAIN_PLANE_SLOPE_Z = 4;
static constexpr int TERRAIN_PLANE_UV_U = 5;
static constexpr int TERRAIN_PLANE_UV_V = 6;

/**
 * Cross-section family (an int on the wire). Slot canyons have their own wall
 * curve; since #487 C they share the floor datum. Mirrored by TerrainProfile in terrainTile.ts.
 */
static constexpr int TERRAIN_PROFILE_OPEN = 0;
static constexpr int TERRAIN_PROFILE_SLOT = 1;

/**
 * How far the slot profile is lowered so its thalweg sits at the same datum as
 * every other biome (#487 C): the slot curve's in-channel constant, 22 × 0.18.
 * Without it the slot floor sat 2–4 m above the water sheet (path + WATER_LEVEL)
 * and the SWE bed needed a per-segment re-datum. Applied to the slot floor and
 * the slot wall shell alike, so the slot canyon moves down rigidly.
 * Mirrored by TERRAIN_SLOT_FLOOR_LIFT in terrainTile.ts.
 */
static constexpr double TERRAIN_SLOT_FLOOR_LIFT = 22.0 * 0.18;

/**
 * Upper bound on grid segments per axis. A 600 m set-piece at the visual
 * density (one row per metre) is 600; this only rejects garbage from JS.
 */
static constexpr int TERRAIN_MAX_SEGMENTS = 4096;
/** Upper bound on vertices per tile (≈ 7 planes × 4 B × 1 Mi = 28 MiB). */
static constexpr int TERRAIN_MAX_VERTICES = 1 << 20;

/** Inputs for one floor tile. Spans are views into caller-owned memory. */
struct TileParams {
    double pathLength = 0.0;
    double canyonWidth = 0.0;
    double waterWidth = 0.0;
    int segmentsX = 0;
    int segmentsZ = 0;
    int profile = TERRAIN_PROFILE_OPEN;
    /** The visual floor carries decorative rock noise; the hull and the SWE bed do not. */
    bool rockNoise = false;
    /** Ice tube / overflow pipe / cavern fold (TubeProfile in terrainTile.ts). */
    bool hasTube = false;
    double tubeCurl = 0.0;
    double tubeCeiling = 0.0;
    /** channelCount × TERRAIN_CHANNEL_STRIDE floats; empty = the default channel. */
    std::span<const float> channel;
};

/** Output planes, TERRAIN_TILE_PLANES × terrainVertexCount() floats, plane-major. */
struct TerrainTile {
    std::span<float> planes;
};

/** Inputs for the outer wall shell (no channel: its height is a closed form of x, z). */
struct WallShellParams {
    double pathLength = 0.0;
    double shellWidth = 0.0;
    int segmentsX = 0;
    int segmentsZ = 0;
    int profile = TERRAIN_PROFILE_OPEN;
    /** TrackBiomeProfile.wallHeight — only the slot profile reads it. */
    double wallHeight = 0.0;
    /** Phase of the ribbing / shelf noise, so neighbouring segments differ. */
    int segmentId = 0;
};

/** (segmentsX + 1) · (segmentsZ + 1), or 0 when either is out of range. */
int terrainVertexCount(int segmentsX, int segmentsZ);

/** One floor sample before the tube fold (canyonFloorFromShape in terrainTile.ts). */
struct CanyonFloorSample {
    double yHeight;
    /** Interpolated corridor half-width — the tube fold's springing. */
    double corridorHalfWidth;
    /** Bank half-width on this side of the centreline. */
    double bankHalfWidth;
    double floorDepth;
};

CanyonFloorSample sampleCanyonFloor(const TileParams& params, double xLocal, double zLocal);

/**
 * Fill every plane of `out`. Returns the vertex count, or 0 (and writes
 * nothing) when the parameters are not finite / out of range or `out` is too
 * small.
 */
int buildTerrainTile(const TileParams& params, TerrainTile& out);

/**
 * Outer wall-shell height relative to the path point (the builder's final
 * `yHeight − 2`), one plane. Same grid convention, with shellWidth in place of
 * canyonWidth. Returns the vertex count, or 0 on invalid input.
 */
int buildWallShell(const WallShellParams& params, std::span<float> out);

#endif  // WATERSHED_TERRAIN_H
