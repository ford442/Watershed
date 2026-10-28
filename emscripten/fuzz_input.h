/**
 * fuzz_input.h — the byte reader every libFuzzer target shares (#467, #502).
 * Host only; never compiled into the WASM.
 */

#ifndef WATERSHED_FUZZ_INPUT_H
#define WATERSHED_FUZZ_INPUT_H

#include <cstddef>
#include <cstdint>
#include <vector>

namespace fuzz {

/** Consumes the fuzz input; past the end it yields zeros. */
struct Input {
    const uint8_t* data;
    size_t size;
    size_t at = 0;

    uint32_t u32() {
        uint32_t v = 0;
        for (int i = 0; i < 4; ++i) v |= static_cast<uint32_t>(at < size ? data[at++] : 0) << (8 * i);
        return v;
    }
    /** Uniform in [lo, hi]. */
    float range(float lo, float hi) {
        return lo + (hi - lo) * (static_cast<float>(u32() & 0xffffffu) / static_cast<float>(0xffffff));
    }
    int pick(int lo, int hi) { return lo + static_cast<int>(u32() % static_cast<uint32_t>(hi - lo + 1)); }
    bool coin() { return (u32() & 1u) != 0; }
    /**
     * A scalar a careless caller sends: NaN, ±inf, a denormal, ±0. The
     * guards are `x <= 0` / `std::max(x, lo)` shaped, which NaN walks through,
     * and uniform draws never land on any of these.
     */
    float special() {
        static constexpr float kSpecial[] = {
            __builtin_nanf(""), -__builtin_nanf(""), __builtin_inff(), -__builtin_inff(),
            1e-40f, -1e-40f, 1.4e-45f, 0.f, -0.f,
        };
        return kSpecial[u32() % (sizeof kSpecial / sizeof kSpecial[0])];
    }
    /** `v` three times in four, otherwise special(). */
    float orSpecial(float v) { return u32() % 4u == 0 ? special() : v; }
    /** range(lo, hi), one draw in four special(). */
    float scalar(float lo, float hi) {
        const float v = range(lo, hi);
        return orSpecial(v);
    }
    double specialDouble() { return static_cast<double>(special()); }
    /** Any float bit pattern, NaN / ±inf / denormals included. */
    float raw() {
        const uint32_t bits = u32();
        float v;
        __builtin_memcpy(&v, &bits, sizeof v);
        return v;
    }
};

/** Seeded xorshift field generator: fields from bytes would be all zeros past a short input. */
struct Field {
    uint32_t state;
    float next(float lo, float hi) {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        return lo + (hi - lo) * (static_cast<float>(state & 0xffffffu) / static_cast<float>(0xffffff));
    }
};

template <typename T>
inline uintptr_t ptr(std::vector<T>& v) { return reinterpret_cast<uintptr_t>(v.data()); }

}  // namespace fuzz

#endif  // WATERSHED_FUZZ_INPUT_H
