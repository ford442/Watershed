/**
 * terrain.cpp — the canyon floor, tube fold and wall shell as planes.
 *
 * See terrain.h for the grid and plane conventions. Every formula here is the
 * one src/components/TrackSegment/hooks/geometryBuilders.ts used to evaluate
 * inline (computeCanyonFloorHeight, sampleChannelShape, applyTubeProfile, the
 * wall-shell loop); src/terrain/terrainTile.ts is the TS mirror, and
 * src/terrain/terrainParity.test.ts pins the two together.
 */

#include "terrain.h"

#include <algorithm>
#include <cmath>
#include <numbers>

namespace {

/** Interpolated channel shape at one path parameter (the TS ChannelShape). */
struct ChannelShape {
    double leftHalfWidth;
    double rightHalfWidth;
    double corridorHalfWidth;
    double floorDepth;
    double floorWave;
    double riffleStrength;
    double gravelBarSide;
    double undercutSide;
};

double lerp(double a, double b, double t) {
    return a + (b - a) * t;
}

double clamp01(double v) {
    return std::max(0.0, std::min(1.0, v));
}

/** THREE.MathUtils.smoothstep(x, min, max). */
double smoothstep(double x, double lo, double hi) {
    if (x <= lo) return 0.0;
    if (x >= hi) return 1.0;
    const double s = (x - lo) / (hi - lo);
    return s * s * (3.0 - 2.0 * s);
}

/** Math.sign(x || 1): 0, −0 and NaN all count as the right bank. */
double sideOf(double x) {
    if (x == 0.0 || std::isnan(x)) return 1.0;
    return x > 0.0 ? 1.0 : -1.0;
}

ChannelShape sampleChannelShape(std::span<const float> channel, double waterWidth, double t) {
    const int count = static_cast<int>(channel.size() / TERRAIN_CHANNEL_STRIDE);
    if (count <= 0) {
        return {
            waterWidth * 0.5,
            waterWidth * 0.5,
            std::max(3.2, waterWidth * 0.5 - 1.2),
            0.0, 0.0, 0.0,
            1.0, -1.0,
        };
    }
    const double scaled = clamp01(t) * static_cast<double>(count - 1);
    const int lower = static_cast<int>(std::floor(scaled));
    const int upper = std::min(count - 1, lower + 1);
    const double alpha = scaled - lower;
    const auto from = channel.subspan(static_cast<size_t>(lower) * TERRAIN_CHANNEL_STRIDE, TERRAIN_CHANNEL_STRIDE);
    const auto to = channel.subspan(static_cast<size_t>(upper) * TERRAIN_CHANNEL_STRIDE, TERRAIN_CHANNEL_STRIDE);
    return {
        lerp(from[0], to[0], alpha),
        lerp(from[1], to[1], alpha),
        lerp(from[2], to[2], alpha),
        lerp(from[3], to[3], alpha),
        lerp(from[4], to[4], alpha),
        lerp(from[5], to[5], alpha),
        alpha < 0.5 ? from[6] : to[6],
        alpha < 0.5 ? from[7] : to[7],
    };
}

struct Folded {
    double x;
    double y;
};

/** The TS applyTubeProfile: corridor untouched, walls arc up and curl inward. */
Folded applyTubeProfile(double xLocal, double yHeight, double corridorHalfWidth,
                        double canyonHalfWidth, double curlIn, double ceiling) {
    const double edge = std::abs(xLocal);
    const double open = std::max(0.5, std::min(corridorHalfWidth, canyonHalfWidth * 0.9));
    if (!std::isfinite(edge) || edge <= open) return {xLocal, yHeight};

    const double span = std::max(1e-3, canyonHalfWidth - open);
    const double climb = std::min(1.0, (edge - open) / span);
    const double curl = std::max(0.0, std::min(1.0, curlIn));
    const double folded = open + (edge - open) * (1.0 - curl * climb * climb);
    const double arc = std::sin(climb * std::numbers::pi * 0.5);
    const double y = yHeight * (1.0 - arc) + ceiling * arc;
    const double sign = xLocal > 0.0 ? 1.0 : (xLocal < 0.0 ? -1.0 : 0.0);
    return {sign * folded, y};
}

bool validTile(const TileParams& p) {
    return std::isfinite(p.pathLength) && p.pathLength > 0.0
        && std::isfinite(p.canyonWidth) && p.canyonWidth > 0.0
        && std::isfinite(p.waterWidth)
        && (!p.hasTube || (std::isfinite(p.tubeCurl) && std::isfinite(p.tubeCeiling)))
        && terrainVertexCount(p.segmentsX, p.segmentsZ) > 0;
}

}  // namespace

int terrainVertexCount(int segmentsX, int segmentsZ) {
    if (segmentsX < 1 || segmentsZ < 1) return 0;
    if (segmentsX > TERRAIN_MAX_SEGMENTS || segmentsZ > TERRAIN_MAX_SEGMENTS) return 0;
    const long long count = static_cast<long long>(segmentsX + 1) * (segmentsZ + 1);
    return count > TERRAIN_MAX_VERTICES ? 0 : static_cast<int>(count);
}

CanyonFloorSample sampleCanyonFloor(const TileParams& p, double xLocal, double zLocal) {
    const bool slot = p.profile == TERRAIN_PROFILE_SLOT;
    const double t = (zLocal + p.pathLength / 2.0) / p.pathLength;
    const ChannelShape shape = sampleChannelShape(p.channel, p.waterWidth, clamp01(t));
    const double bankWidth = xLocal < 0.0 ? shape.leftHalfWidth : shape.rightHalfWidth;
    const double corridorWidth = std::max(1.2, shape.corridorHalfWidth);
    const double dist = std::abs(xLocal);
    const double normalizedDist = dist / (p.canyonWidth * 0.45);
    const double bankRatio = dist / std::max(0.001, bankWidth);
    const double side = sideOf(xLocal);
    const double gravelBar = shape.gravelBarSide == side ? 1.0 : 0.0;
    const double undercut = shape.undercutSide == side ? 1.0 : 0.0;

    double y = slot
        ? 22.0 + std::pow(std::max(0.0, normalizedDist), 1.8) * 18.0
        : std::pow(std::max(0.0, normalizedDist), 2.5) * 12.0;

    if (dist < bankWidth) {
        const double inChannel = dist / std::max(0.001, bankWidth);
        const double corridorEase = smoothstep(inChannel, 0.0, 1.0);
        y *= slot ? 0.18 : 0.1;
        y -= shape.floorDepth * 1.4;
        y += shape.floorWave * (dist < corridorWidth ? 0.2 : 0.55);
        y += std::max(0.0, shape.riffleStrength) * inChannel * 0.35;
        y += std::max(0.0, 1.0 - corridorEase) * 0.05;
    } else {
        const double aboveBank = std::max(0.0, bankRatio - 1.0);
        y += aboveBank * aboveBank * 4.5 * undercut;
        y -= aboveBank * 1.25 * gravelBar;
    }
    if (slot) y -= TERRAIN_SLOT_FLOOR_LIFT;

    if (p.rockNoise) {
        const double rockNoise =
            std::sin(zLocal * 0.8 + xLocal * 0.5) * 0.3 + std::sin(zLocal * 2.5 + xLocal * 1.2) * 0.1;
        y += rockNoise * (0.5 + normalizedDist);
    }

    return {y, shape.corridorHalfWidth, bankWidth, shape.floorDepth};
}

int buildTerrainTile(const TileParams& p, TerrainTile& out) {
    if (!validTile(p)) return 0;
    const int n = terrainVertexCount(p.segmentsX, p.segmentsZ);
    if (out.planes.size() < static_cast<size_t>(n) * TERRAIN_TILE_PLANES) return 0;

    const auto plane = [&](int k) {
        return out.planes.subspan(static_cast<size_t>(k) * n, static_cast<size_t>(n));
    };
    const std::span<float> px = plane(TERRAIN_PLANE_X);
    const std::span<float> ph = plane(TERRAIN_PLANE_H);
    const std::span<float> pBank = plane(TERRAIN_PLANE_BANK);
    const std::span<float> pSlopeX = plane(TERRAIN_PLANE_SLOPE_X);
    const std::span<float> pSlopeZ = plane(TERRAIN_PLANE_SLOPE_Z);
    const std::span<float> pU = plane(TERRAIN_PLANE_UV_U);
    const std::span<float> pV = plane(TERRAIN_PLANE_UV_V);

    const int cols = p.segmentsX + 1;
    const double cellX = p.canyonWidth / p.segmentsX;
    const double cellZ = p.pathLength / p.segmentsZ;
    const double halfW = p.canyonWidth / 2.0;
    const double halfL = p.pathLength / 2.0;

    for (int iz = 0; iz <= p.segmentsZ; ++iz) {
        const double z = iz * cellZ - halfL;
        const double v = static_cast<double>(iz) / p.segmentsZ * p.pathLength;
        for (int ix = 0; ix < cols; ++ix) {
            const int i = iz * cols + ix;
            const double x = ix * cellX - halfW;
            const CanyonFloorSample s = sampleCanyonFloor(p, x, z);
            const Folded f = p.hasTube
                ? applyTubeProfile(x, s.yHeight, s.corridorHalfWidth, halfW, p.tubeCurl, p.tubeCeiling)
                : Folded{x, s.yHeight};
            px[i] = static_cast<float>(f.x);
            ph[i] = static_cast<float>(f.y);
            pBank[i] = std::abs(x) >= s.bankHalfWidth ? 1.f : 0.f;
            pU[i] = static_cast<float>(static_cast<double>(ix) / p.segmentsX);
            pV[i] = static_cast<float>(v);
        }
    }

    // Slopes from the rounded H plane, so both backends difference the same floats.
    for (int iz = 0; iz <= p.segmentsZ; ++iz) {
        const int z0 = std::max(0, iz - 1);
        const int z1 = std::min(p.segmentsZ, iz + 1);
        for (int ix = 0; ix < cols; ++ix) {
            const int x0 = std::max(0, ix - 1);
            const int x1 = std::min(p.segmentsX, ix + 1);
            const int i = iz * cols + ix;
            const double dhx = static_cast<double>(ph[iz * cols + x1]) - static_cast<double>(ph[iz * cols + x0]);
            const double dhz = static_cast<double>(ph[z1 * cols + ix]) - static_cast<double>(ph[z0 * cols + ix]);
            pSlopeX[i] = static_cast<float>(dhx / ((x1 - x0) * cellX));
            pSlopeZ[i] = static_cast<float>(dhz / ((z1 - z0) * cellZ));
        }
    }
    return n;
}

int buildWallShell(const WallShellParams& p, std::span<float> out) {
    if (!std::isfinite(p.pathLength) || p.pathLength <= 0.0) return 0;
    if (!std::isfinite(p.shellWidth) || p.shellWidth <= 0.0 || !std::isfinite(p.wallHeight)) return 0;
    const int n = terrainVertexCount(p.segmentsX, p.segmentsZ);
    if (n == 0 || out.size() < static_cast<size_t>(n)) return 0;

    const bool slot = p.profile == TERRAIN_PROFILE_SLOT;
    const int cols = p.segmentsX + 1;
    const double cellX = p.shellWidth / p.segmentsX;
    const double cellZ = p.pathLength / p.segmentsZ;
    const double seg = static_cast<double>(p.segmentId);
    const double ribPhase = seg * 0.91;
    const double shelfSteps = slot ? 5.0 : 3.0;

    for (int iz = 0; iz <= p.segmentsZ; ++iz) {
        const double z = iz * cellZ - p.pathLength / 2.0;
        for (int ix = 0; ix < cols; ++ix) {
            const double x = ix * cellX - p.shellWidth / 2.0;
            const double dist = std::abs(x);
            double y = slot ? p.wallHeight + dist * 0.18 : 15.0 + dist * 0.5;
            y += std::sin(z * 0.1) * (slot ? 1.8 : 3.0) + std::cos(x * 0.2) * (slot ? 1.1 : 2.0);
            const double ribbing =
                std::sin(z * (slot ? 0.5 : 0.38) + x * 0.12 + ribPhase) * std::sin(x * 0.22 - ribPhase * 0.6);
            y += ribbing * (slot ? 1.1 : 0.7);
            const double shelfRaw = std::sin(z * 0.085 + x * 0.04 + seg * 0.21) * 0.5 + 0.5;
            const double shelf = std::floor(shelfRaw * shelfSteps) / shelfSteps;
            y += (shelf - 0.5) * (slot ? 2.2 : 1.2);
            if (slot) y -= TERRAIN_SLOT_FLOOR_LIFT;
            out[static_cast<size_t>(iz) * cols + ix] = static_cast<float>(y - 2.0);
        }
    }
    return n;
}
