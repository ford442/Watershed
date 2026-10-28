/**
 * native_digest.h — bit-exact digests of the SWE, routing and terrain kernels.
 *
 * One scenario per kernel, built only from values that are exact in float32
 * and in a JS double (integers scaled by powers of two), so the host build and
 * a JS driver of the wasm hand the kernels bit-identical input. The output is
 * hashed bit for bit (FNV-1a over each float's 32 bits), so a digest match
 * means the outputs are equal, not merely close.
 *
 *   host:  host_smoke.cpp checks k*Digest below (routing and terrain on glibc
 *          hosts only: they call the host libm, and these are glibc's numbers,
 *          equal to the wasm's musl here). WATERSHED_PRINT_DIGESTS=1
 *          watershed_host_smoke prints fresh ones.
 *   wasm:  src/systems/water/nativeDigest.integration.test.ts (`pnpm test:wasm`)
 *          replays the same calls through the shipped pair and reads the
 *          expected digests out of this file
 *
 * Change a scenario here and in the TS driver together, then regenerate.
 * Host only; never compiled into the wasm.
 */

#ifndef WATERSHED_NATIVE_DIGEST_H
#define WATERSHED_NATIVE_DIGEST_H

#include "routing.h"
#include "swe.h"
#include "terrain.h"
#include "terrain_goldens.h"

#include <cstdint>
#include <cstring>
#include <vector>

namespace native_digest {

// Expected digests. The TS driver parses these three lines; keep the format.
inline constexpr uint32_t kSweDigest = 0xb6bca6d3u;
inline constexpr uint32_t kRoutingDigest = 0x1538e102u;
inline constexpr uint32_t kTerrainDigest = 0x1e257ac8u;

struct Fnv {
    uint32_t h = 0x811c9dc5u;
    void add(uint32_t v) {
        for (int i = 0; i < 4; ++i) {
            h ^= (v >> (8 * i)) & 0xffu;
            h *= 0x01000193u;
        }
    }
    void add(float v) {
        uint32_t bits;
        std::memcpy(&bits, &v, sizeof bits);
        add(bits);
    }
    void add(const std::vector<float>& v) {
        for (float x : v) add(x);
    }
};

inline uint32_t xorshift(uint32_t& s) {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return s;
}

template <typename T>
inline uintptr_t at(std::vector<T>& v) { return reinterpret_cast<uintptr_t>(v.data()); }

/**
 * 40 x 24 cells over a random bed: 30 steps alternating the routed-edge and
 * plain steppers, every event kind at step 8, a scroll at step 16.
 */
inline uint32_t sweDigest() {
    constexpr int W = 40;
    constexpr int Z = 24;
    constexpr int N = W * Z;
    constexpr float kDx = 0.5f;
    constexpr float kG = 9.80665f;
    constexpr float kH = 1.f;
    std::vector<float> h(N), u(N), w(N), b(N);
    uint32_t s = 0x9e3779b9u;
    for (int i = 0; i < N; ++i) {
        const uint32_t r = xorshift(s);
        b[i] = static_cast<float>(r & 0xffu) * 0x1p-9f;
        h[i] = (static_cast<float>((r >> 8) & 0xfffu) - 2048.f) * 0x1p-14f;
        u[i] = (static_cast<float>((r >> 20) & 0x3ffu) - 512.f) * 0x1p-9f;
        w[i] = (static_cast<float>(xorshift(s) & 0x3ffu) - 512.f) * 0x1p-9f;
    }
    reserveShallowWaterScratch(W, Z);
    for (int k = 0; k < 30; ++k) {
        if (k % 2 == 0) {
            stepShallowWaterInflow(at(h), at(u), at(w), at(b), W, Z, 0.02f, kG, kDx, kH, 0.15f);
        } else {
            stepShallowWater(at(h), at(u), at(w), at(b), W, Z, 0.02f, kG, kDx, kH);
        }
        if (k == 8) {
            for (int kind = 0; kind <= 4; ++kind) {
                applySWEEvent(at(h), at(u), at(w), at(b), W, Z, kDx, -10.f, -6.f, kH, kind,
                              -6.f + 3.f * static_cast<float>(kind), 0.f, 2.5f, 0.75f, 0.02f);
            }
        }
        if (k == 16) scrollShallowWater(at(h), at(u), at(w), at(b), W, Z, 1, -2, 0.0625f, 0.125f, -0.25f);
    }
    Fnv f;
    f.add(h);
    f.add(u);
    f.add(w);
    f.add(b);
    return f.h;
}

/**
 * The 20-segment chain of host_smoke §8 with exact slopes: steady at 40 m³/s,
 * 60 one-second steps of a square-wave release (odd steps with rain on every
 * third segment), the travel time, and the edge state of every outflow.
 */
inline uint32_t routingDigest() {
    constexpr int kSeg = 20;
    std::vector<float> L(kSeg), S(kSeg), B(kSeg), lateral(kSeg);
    for (int k = 0; k < kSeg; ++k) {
        L[k] = 95.f + 2.f * static_cast<float>(k % 5);
        S[k] = static_cast<float>(6 + k % 3) * 0x1p-8f;
        B[k] = 10.f + static_cast<float>(k % 4);
        lateral[k] = k % 3 == 0 ? 0.5f : 0.f;
    }
    std::vector<float> storage(kSeg * ROUTING_SUBREACHES), outflow(kSeg), lag(kSeg);
    routeReachSteady(at(L), at(S), at(B), kSeg, 40.f, at(storage), at(outflow));
    for (int t = 0; t < 60; ++t) {
        const float q = t % 20 < 10 ? 54.f : 40.f;
        if (t % 2 == 1) {
            routeReachLateral(at(L), at(S), at(B), kSeg, q, at(lateral), 1.f, at(storage), at(outflow));
        } else {
            routeReach(at(L), at(S), at(B), kSeg, q, 1.f, at(storage), at(outflow));
        }
    }
    routeReachTravelTime(at(L), at(S), at(B), kSeg, 40.f, at(lag));
    Fnv f;
    f.add(storage);
    f.add(outflow);
    f.add(lag);
    for (float q : outflow) {
        const RoutedEdge e = routedEdgeState(q, 40.f, 1.f, 9.80665f);
        f.add(e.eta);
        f.add(e.speed);
    }
    return f.h;
}

/** Every terrain_goldens fixture tile and wall shell, plane by plane. */
inline uint32_t terrainDigest() {
    using namespace terrain_goldens;
    Fnv f;
    for (const Fixture& fx : kFixtures) {
        TileParams p;
        p.pathLength = fx.pathLength;
        p.canyonWidth = fx.canyonWidth;
        p.waterWidth = fx.waterWidth;
        p.segmentsX = fx.segmentsX;
        p.segmentsZ = fx.segmentsZ;
        p.profile = fx.profile;
        p.rockNoise = fx.rockNoise;
        p.hasTube = fx.hasTube;
        p.tubeCurl = fx.tubeCurl;
        p.tubeCeiling = fx.tubeCeiling;
        p.channel = std::span<const float>(fx.channel, static_cast<size_t>(fx.channelCount) * TERRAIN_CHANNEL_STRIDE);
        const int n = terrainVertexCount(fx.segmentsX, fx.segmentsZ);
        std::vector<float> planes(static_cast<size_t>(n) * TERRAIN_TILE_PLANES);
        TerrainTile tile{planes};
        f.add(static_cast<uint32_t>(buildTerrainTile(p, tile)));
        f.add(planes);
    }
    for (const WallFixture& wf : kWallFixtures) {
        const int n = terrainVertexCount(wf.params.segmentsX, wf.params.segmentsZ);
        std::vector<float> shell(static_cast<size_t>(n));
        f.add(static_cast<uint32_t>(buildWallShell(wf.params, shell)));
        f.add(shell);
    }
    return f.h;
}

}  // namespace native_digest

#endif  // WATERSHED_NATIVE_DIGEST_H
