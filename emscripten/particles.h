/**
 * particles.h — Embind-free SoA particle buffers (waterfall + splash integrate).
 *
 * Layout: 9 planes of `capacity` floats, packed as
 *   px, py, pz, vx, vy, vz, life, maxLife, scale
 * at byte offset plane * capacity * 4 from `base`.
 *
 * Spawn stays in TypeScript. This TU owns age / Euler / chute recycle.
 */

#ifndef WATERSHED_PARTICLES_H
#define WATERSHED_PARTICLES_H

#include "common.h"
#include <cstdint>

/** Number of SoA planes. Mirrored by PARTICLE_SOA_PLANES in TypeScript. */
static constexpr int PARTICLE_SOA_PLANES = 9;
static constexpr int PARTICLE_PX = 0;
static constexpr int PARTICLE_PY = 1;
static constexpr int PARTICLE_PZ = 2;
static constexpr int PARTICLE_VX = 3;
static constexpr int PARTICLE_VY = 4;
static constexpr int PARTICLE_VZ = 5;
static constexpr int PARTICLE_LIFE = 6;
static constexpr int PARTICLE_MAXLIFE = 7;
static constexpr int PARTICLE_SCALE = 8;

/** Allocate 9 * capacity floats (zeroed). Same allocator as allocateGrid. */
uintptr_t allocateParticleSoA(int capacity);

/** Free a pointer from allocateParticleSoA / allocateGrid. */
void freeParticleSoA(uintptr_t ptr);

/**
 * Fill [0, active) with a waterfall chute. `seed` is updated (xorshift).
 * vy is stored as world units per second (negative = falling).
 */
uint32_t initWaterfallParticles(uintptr_t base, int capacity, int active,
                                float width, float height, float depthZ,
                                float fanSpreadRad, uint32_t seed);

uint32_t stepWaterfallParticles(uintptr_t base, int capacity, int active,
                                float dt, float width, float height, float depthZ,
                                uint32_t seed);

/**
 * Euler + gravity + velocity damp + age for dense slots [0, count).
 * life >= maxLife → life = -1 (caller deactivates).
 */
void stepSplashParticles(uintptr_t base, int capacity, int count,
                         float dt, float gravityY, float damp);

#endif  // WATERSHED_PARTICLES_H
