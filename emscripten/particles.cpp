/**
 * particles.cpp — SoA waterfall / splash integrate on the WASM (or host) heap.
 *
 * Zero GC. 4-wide Euler via simdf32.h; recycle / death remain scalar.
 */

#include "particles.h"
#include "simdf32.h"

#include <cstdint>
#include <cstdlib>
#include <cmath>
#include <cstddef>

namespace {

float* plane(uintptr_t base, int which, int capacity) {
    return reinterpret_cast<float*>(base) + which * capacity;
}

uint32_t xorshift32(uint32_t& s) {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    if (s == 0) s = 0x9e3779b9u;
    return s;
}

float rand01(uint32_t& s) {
    return static_cast<float>(xorshift32(s) >> 8) * (1.f / 16777216.f);
}

void euler4(float* px, float* py, float* pz,
            const float* vx, const float* vy, const float* vz,
            int n, float dt) {
    const f32x4 vdt = f32x4_splat(dt);
    int i = 0;
    for (; i + 4 <= n; i += 4) {
        f32x4_store(px + i, f32x4_add(f32x4_load(px + i), f32x4_mul(f32x4_load(vx + i), vdt)));
        f32x4_store(py + i, f32x4_add(f32x4_load(py + i), f32x4_mul(f32x4_load(vy + i), vdt)));
        f32x4_store(pz + i, f32x4_add(f32x4_load(pz + i), f32x4_mul(f32x4_load(vz + i), vdt)));
    }
    for (; i < n; ++i) {
        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
        pz[i] += vz[i] * dt;
    }
}

}  // namespace

uintptr_t allocateParticleSoA(int capacity) {
    if (capacity <= 0) return 0;
    const int count = PARTICLE_SOA_PLANES * capacity;
    void* ptr = std::calloc(static_cast<std::size_t>(count), sizeof(float));
    return reinterpret_cast<uintptr_t>(ptr);
}

void freeParticleSoA(uintptr_t ptr) {
    std::free(reinterpret_cast<void*>(ptr));
}

uint32_t initWaterfallParticles(uintptr_t base, int capacity, int active,
                                float width, float height, float depthZ,
                                float fanSpreadRad, uint32_t seed) {
    if (base == 0 || capacity <= 0) return seed;
    if (active < 0) active = 0;
    if (active > capacity) active = capacity;

    float* px = plane(base, PARTICLE_PX, capacity);
    float* py = plane(base, PARTICLE_PY, capacity);
    float* pz = plane(base, PARTICLE_PZ, capacity);
    float* vx = plane(base, PARTICLE_VX, capacity);
    float* vy = plane(base, PARTICLE_VY, capacity);
    float* vz = plane(base, PARTICLE_VZ, capacity);
    float* life = plane(base, PARTICLE_LIFE, capacity);
    float* maxLife = plane(base, PARTICLE_MAXLIFE, capacity);
    float* scale = plane(base, PARTICLE_SCALE, capacity);

    uint32_t s = seed ? seed : 0x9e3779b9u;
    constexpr float kHz = 60.f;
    for (int i = 0; i < active; ++i) {
        px[i] = (rand01(s) - 0.5f) * width;
        py[i] = rand01(s) * height;
        pz[i] = (rand01(s) - 0.5f) * depthZ;
        const float frameSpeed = 0.2f + rand01(s) * 0.3f;
        vy[i] = -(frameSpeed * kHz);
        if (fanSpreadRad > 0.f) {
            const float angle = (rand01(s) - 0.5f) * fanSpreadRad;
            vx[i] = std::sin(angle) * frameSpeed * 1.5f * kHz;
            vz[i] = std::cos(angle) * frameSpeed * 0.3f * kHz;
        } else {
            vx[i] = 0.f;
            vz[i] = 0.f;
        }
        life[i] = 0.f;
        maxLife[i] = 1.e9f;
        scale[i] = 0.5f + rand01(s) * 0.5f;
    }
    return s;
}

uint32_t stepWaterfallParticles(uintptr_t base, int capacity, int active,
                                float dt, float width, float height, float depthZ,
                                uint32_t seed) {
    if (base == 0 || capacity <= 0 || dt <= 0.f) return seed;
    if (active < 0) active = 0;
    if (active > capacity) active = capacity;

    float* px = plane(base, PARTICLE_PX, capacity);
    float* py = plane(base, PARTICLE_PY, capacity);
    float* pz = plane(base, PARTICLE_PZ, capacity);
    const float* vx = plane(base, PARTICLE_VX, capacity);
    const float* vy = plane(base, PARTICLE_VY, capacity);
    const float* vz = plane(base, PARTICLE_VZ, capacity);

    euler4(px, py, pz, vx, vy, vz, active, dt);

    uint32_t s = seed ? seed : 0x9e3779b9u;
    for (int i = 0; i < active; ++i) {
        if (py[i] < 0.f) {
            py[i] = height;
            px[i] = (rand01(s) - 0.5f) * width;
            pz[i] = (rand01(s) - 0.5f) * depthZ;
        }
    }
    return s;
}

void stepSplashParticles(uintptr_t base, int capacity, int count,
                         float dt, float gravityY, float damp) {
    if (base == 0 || capacity <= 0 || count <= 0 || dt <= 0.f) return;
    if (count > capacity) count = capacity;

    float* px = plane(base, PARTICLE_PX, capacity);
    float* py = plane(base, PARTICLE_PY, capacity);
    float* pz = plane(base, PARTICLE_PZ, capacity);
    float* vx = plane(base, PARTICLE_VX, capacity);
    float* vy = plane(base, PARTICLE_VY, capacity);
    float* vz = plane(base, PARTICLE_VZ, capacity);
    float* life = plane(base, PARTICLE_LIFE, capacity);
    const float* maxLife = plane(base, PARTICLE_MAXLIFE, capacity);

    euler4(px, py, pz, vx, vy, vz, count, dt);

    const f32x4 vdt = f32x4_splat(dt);
    const f32x4 vg = f32x4_splat(gravityY);
    const f32x4 vd = f32x4_splat(damp);
    int i = 0;
    for (; i + 4 <= count; i += 4) {
        f32x4_store(vy + i, f32x4_add(f32x4_load(vy + i), f32x4_mul(vg, vdt)));
        f32x4_store(vx + i, f32x4_mul(f32x4_load(vx + i), vd));
        f32x4_store(vy + i, f32x4_mul(f32x4_load(vy + i), vd));
        f32x4_store(vz + i, f32x4_mul(f32x4_load(vz + i), vd));
        f32x4_store(life + i, f32x4_add(f32x4_load(life + i), vdt));
    }
    for (; i < count; ++i) {
        vy[i] += gravityY * dt;
        vx[i] *= damp;
        vy[i] *= damp;
        vz[i] *= damp;
        life[i] += dt;
    }
    for (int j = 0; j < count; ++j) {
        if (life[j] >= maxLife[j]) life[j] = -1.f;
    }
}
