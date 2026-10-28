/**
 * terrain_fuzz.cpp — libFuzzer target over the terrain tile builders (#502, host only).
 *
 * buildTerrainTile / buildWallShell with any double bit pattern in the shape
 * parameters (NaN, ±inf, denormals and ±0 drawn on purpose; with only those
 * and physical values an accepted tile must be finite), segment counts that are sometimes non-positive or past
 * TERRAIN_MAX_SEGMENTS, any profile / tube flags, a channel profile of random
 * length, and an output span that is sometimes one float short. A call must
 * either return terrainVertexCount() and fill every plane, or return 0 and
 * write nothing; under ASan + UBSan any out-of-bounds access is a crash.
 *
 *   pnpm test:native:fuzz              # every target, 60 s each
 */

#include "fuzz_input.h"
#include "terrain.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace {

void require(bool ok, const char* what) {
    if (!ok) {
        std::fprintf(stderr, "terrain_fuzz: %s\n", what);
        std::abort();
    }
}

double rawDouble(fuzz::Input& in) {
    const uint64_t bits = static_cast<uint64_t>(in.u32()) | (static_cast<uint64_t>(in.u32()) << 32);
    double v;
    std::memcpy(&v, &bits, sizeof v);
    return v;
}

/**
 * A physical value half the time, a special one (NaN, ±inf, a denormal, ±0)
 * a quarter, any bit pattern otherwise. `raw` records the last, after which a
 * huge finite parameter may legitimately overflow to a non-finite vertex.
 */
double value(fuzz::Input& in, float lo, float hi, bool& raw) {
    switch (in.u32() % 4u) {
        case 0: raw = true; return rawDouble(in);
        case 1: return in.specialDouble();
        default: return static_cast<double>(in.range(lo, hi));
    }
}

bool allFinite(const std::vector<float>& v) {
    return std::all_of(v.begin(), v.end(), [](float x) { return std::isfinite(x); });
}

int segments(fuzz::Input& in) {
    switch (in.u32() % 8u) {
        case 0: return 0;
        case 1: return -in.pick(1, 1 << 20);
        case 2: return TERRAIN_MAX_SEGMENTS + in.pick(1, 1 << 20);
        default: return in.pick(1, 48);
    }
}

constexpr float kUntouched = 7.f;

}  // namespace

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    fuzz::Input in{data, size};
    const int sx = segments(in);
    const int sz = segments(in);
    const int n = terrainVertexCount(sx, sz);
    const bool shortOut = in.coin() && n > 0;
    const size_t outFloats = n > 0 ? static_cast<size_t>(n) * TERRAIN_TILE_PLANES - (shortOut ? 1 : 0) : 1;
    bool raw = false;

    if (in.coin()) {
        TileParams params;
        params.pathLength = value(in, 1.f, 600.f, raw);
        params.canyonWidth = value(in, 2.f, 120.f, raw);
        params.waterWidth = value(in, 1.f, 80.f, raw);
        params.segmentsX = sx;
        params.segmentsZ = sz;
        params.profile = in.coin() ? in.pick(-2, 4) : TERRAIN_PROFILE_OPEN;
        params.rockNoise = in.coin();
        params.hasTube = in.coin();
        params.tubeCurl = value(in, 0.f, 1.f, raw);
        params.tubeCeiling = value(in, 0.f, 30.f, raw);
        std::vector<float> channel(static_cast<size_t>(in.pick(0, 12)) * TERRAIN_CHANNEL_STRIDE);
        bool rawChannel = false;
        for (float& v : channel) {
            const bool bits = in.coin();
            rawChannel = rawChannel || bits;
            v = bits ? in.raw() : in.range(-10.f, 40.f);
        }
        params.channel = channel;
        std::vector<float> out(outFloats, kUntouched);
        TerrainTile tile{out};
        const int got = buildTerrainTile(params, tile);
        require(got == 0 || (got == n && !shortOut), "buildTerrainTile returned neither 0 nor the vertex count");
        if (got == 0) {
            require(std::all_of(out.begin(), out.end(), [](float v) { return v == kUntouched; }),
                    "a rejected buildTerrainTile wrote its output");
        } else if (!raw && !rawChannel) {
            require(allFinite(out), "buildTerrainTile accepted a special scalar and wrote a non-finite vertex");
        }
    } else {
        WallShellParams params;
        params.pathLength = value(in, 1.f, 600.f, raw);
        params.shellWidth = value(in, 2.f, 160.f, raw);
        params.segmentsX = sx;
        params.segmentsZ = sz;
        params.profile = in.coin() ? in.pick(-2, 4) : TERRAIN_PROFILE_OPEN;
        params.wallHeight = value(in, 0.f, 60.f, raw);
        params.segmentId = static_cast<int>(in.u32());
        const size_t shellFloats = n > 0 ? static_cast<size_t>(n) - (shortOut ? 1 : 0) : 1;
        std::vector<float> out(shellFloats, kUntouched);
        const int got = buildWallShell(params, out);
        require(got == 0 || (got == n && !shortOut), "buildWallShell returned neither 0 nor the vertex count");
        if (got == 0) {
            require(std::all_of(out.begin(), out.end(), [](float v) { return v == kUntouched; }),
                    "a rejected buildWallShell wrote its output");
        } else if (!raw) {
            require(allFinite(out), "buildWallShell accepted a special scalar and wrote a non-finite height");
        }
    }
    return 0;
}
