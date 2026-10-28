/**
 * routing.cpp — kinematic-storage routing along the campaign chain.
 *
 * See routing.h for the scheme and the array layout. Scalar on purpose: this
 * is a few hundred reservoirs per call, not the Riemann fan.
 */

#include "routing.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <span>

namespace {

/**
 * `x`, or `lo` when x is below it or not finite. Every per-segment and head
 * scalar goes through this: std::max(x, lo) returns its first operand when x
 * is NaN, so one NaN discharge or length used to poison the chain for the
 * session, and +inf turns into inf / inf = NaN a step later.
 */
float atLeast(float x, float lo) {
    return std::isfinite(x) ? std::max(lo, x) : lo;
}

float clampSlope(float slope) {
    if (!(slope > ROUTING_MIN_SLOPE)) return ROUTING_MIN_SLOPE;  // also catches NaN
    return std::min(slope, ROUTING_MAX_SLOPE);
}

/**
 * Celerity coefficient β with c = β · Q^0.4.
 *
 * Wide rectangle, Manning: y = (n Q / (B √S))^0.6, V = Q / (B y), c = 5/3 V
 *   ⇒ c = (5/3) · (√S / n)^0.6 · B^−0.4 · Q^0.4
 */
float celerityCoeff(float width, float slope) {
    const float B = atLeast(width, 0.5f);
    const float S = clampSlope(slope);
    return (5.f / 3.f) * std::pow(std::sqrt(S) / ROUTING_MANNING_N, 0.6f) * std::pow(B, -0.4f);
}

/**
 * Volume coefficient α with S = α · Q^0.6: the water a reach of length l
 * holds, l · B · y, with y from the same Manning rating.
 */
float volumeCoeff(float l, float width, float slope) {
    const float B = atLeast(width, 0.5f);
    const float S = clampSlope(slope);
    return l * B * std::pow(ROUTING_MANNING_N / (B * std::sqrt(S)), 0.6f);
}

float storageFor(float Q, float alpha) {
    return alpha * std::pow(atLeast(Q, 0.f), 0.6f);
}

/** Inverse of storageFor: Q = (S / α)^(5/3). */
/** A segment count from JS: [1, ROUTING_MAX_SEGMENTS]. */
bool validSegments(int nSeg) {
    return nSeg > 0 && nSeg <= ROUTING_MAX_SEGMENTS;
}

/** The nSeg-long per-segment plane at `ptr`. */
template <typename T>
std::span<T> segmentPlane(uintptr_t ptr, int nSeg) {
    return heapSpan<T>(ptr, static_cast<std::size_t>(nSeg));
}

/** The nSeg * ROUTING_SUBREACHES reservoir storage at `ptr`. */
std::span<float> storagePlane(uintptr_t ptr, int nSeg) {
    return heapSpan<float>(ptr, static_cast<std::size_t>(nSeg) * ROUTING_SUBREACHES);
}

float dischargeFor(float S, float alpha) {
    return std::pow(atLeast(S, 0.f) / alpha, 5.f / 3.f);
}

}  // namespace

float routingCelerity(float Q, float width, float slope) {
    return celerityCoeff(width, slope) * std::pow(atLeast(Q, 0.f), 0.4f);
}

void routeReachSteady(uintptr_t lengthsPtr, uintptr_t slopesPtr, uintptr_t widthsPtr, int nSeg,
                      float Q, uintptr_t storagePtr, uintptr_t outflowPtr) {
    if (!validSegments(nSeg) || lengthsPtr == 0 || slopesPtr == 0 || widthsPtr == 0) return;
    if (storagePtr == 0 || outflowPtr == 0) return;
    const std::span<const float> L = segmentPlane<const float>(lengthsPtr, nSeg);
    const std::span<const float> slope = segmentPlane<const float>(slopesPtr, nSeg);
    const std::span<const float> B = segmentPlane<const float>(widthsPtr, nSeg);
    const std::span<float> storage = storagePlane(storagePtr, nSeg);
    const std::span<float> outflow = segmentPlane<float>(outflowPtr, nSeg);
    const float q = atLeast(Q, 0.f);

    for (int k = 0; k < nSeg; ++k) {
        const float l = atLeast(L[k], 1e-3f) / static_cast<float>(ROUTING_SUBREACHES);
        const float alpha = volumeCoeff(l, B[k], slope[k]);
        for (int j = 0; j < ROUTING_SUBREACHES; ++j) {
            storage[static_cast<std::size_t>(k) * ROUTING_SUBREACHES + static_cast<std::size_t>(j)] = storageFor(q, alpha);
        }
        outflow[k] = q;
    }
}

void routeReach(uintptr_t lengthsPtr, uintptr_t slopesPtr, uintptr_t widthsPtr, int nSeg,
                float inflowQ, float dt, uintptr_t storagePtr, uintptr_t outflowPtr) {
    routeReachLateral(lengthsPtr, slopesPtr, widthsPtr, nSeg, inflowQ, 0, dt, storagePtr, outflowPtr);
}

void routeReachLateral(uintptr_t lengthsPtr, uintptr_t slopesPtr, uintptr_t widthsPtr, int nSeg,
                       float inflowQ, uintptr_t lateralPtr, float dt, uintptr_t storagePtr,
                       uintptr_t outflowPtr) {
    if (!validSegments(nSeg) || lengthsPtr == 0 || slopesPtr == 0 || widthsPtr == 0) return;
    if (storagePtr == 0 || outflowPtr == 0) return;
    if (!(dt >= ROUTING_MIN_DT) || !std::isfinite(dt)) return;  // NaN, denormal or inf: see ROUTING_MIN_DT
    const std::span<const float> L = segmentPlane<const float>(lengthsPtr, nSeg);
    const std::span<const float> slope = segmentPlane<const float>(slopesPtr, nSeg);
    const std::span<const float> B = segmentPlane<const float>(widthsPtr, nSeg);
    const std::span<float> storage = storagePlane(storagePtr, nSeg);
    const std::span<float> outflow = segmentPlane<float>(outflowPtr, nSeg);
    // No plane at all is routeReach: the head inflow alone, bit for bit.
    const std::span<const float> lateral =
        lateralPtr != 0 ? segmentPlane<const float>(lateralPtr, nSeg) : std::span<const float>{};

    // Mean inflow to the next reservoir over this step.
    float inflow = atLeast(inflowQ, 0.f);
    for (int k = 0; k < nSeg; ++k) {
        // Rain over this reach joins at its top (a non-finite or negative entry adds nothing).
        if (!lateral.empty() && lateral[k] > 0.f && std::isfinite(lateral[k])) inflow += lateral[k];
        const float l = atLeast(L[k], 1e-3f) / static_cast<float>(ROUTING_SUBREACHES);
        const float alpha = volumeCoeff(l, B[k], slope[k]);
        for (int j = 0; j < ROUTING_SUBREACHES; ++j) {
            float& S = storage[static_cast<std::size_t>(k) * ROUTING_SUBREACHES + static_cast<std::size_t>(j)];
            // Linearise Q(S) about the current state for the step:
            //   Q ≈ Q0 + (S − S0) / Kc,   Kc = dS/dQ = 0.6 S / Q = l / c(Q)
            // so a disturbance crosses the reservoir at the kinematic celerity.
            const float Q0 = std::max(dischargeFor(S, alpha), ROUTING_MIN_DISCHARGE);
            const float Kc = 0.6f * storageFor(Q0, alpha) / Q0;
            // Exact integration of dS/dt = I − Q0 − (S − S0)/Kc with constant I.
            const float equilibrium = S + Kc * (inflow - Q0);
            const float next = std::max(0.f, equilibrium + (S - equilibrium) * std::exp(-dt / Kc));
            // Whatever the reservoir does not keep leaves it: volume is conserved.
            const float outVolume = inflow * dt + (S - next);
            S = next;
            inflow = outVolume / dt;
        }
        outflow[k] = inflow;
    }
}

void routeReachTravelTime(uintptr_t lengthsPtr, uintptr_t slopesPtr, uintptr_t widthsPtr, int nSeg,
                          float Q, uintptr_t lagPtr) {
    if (!validSegments(nSeg) || lengthsPtr == 0 || slopesPtr == 0 || widthsPtr == 0 || lagPtr == 0) return;
    const std::span<const float> L = segmentPlane<const float>(lengthsPtr, nSeg);
    const std::span<const float> slope = segmentPlane<const float>(slopesPtr, nSeg);
    const std::span<const float> B = segmentPlane<const float>(widthsPtr, nSeg);
    const std::span<float> lag = segmentPlane<float>(lagPtr, nSeg);
    const float q = atLeast(Q, ROUTING_MIN_DISCHARGE);

    float total = 0.f;
    for (int k = 0; k < nSeg; ++k) {
        total += atLeast(L[k], 1e-3f) / routingCelerity(q, B[k], slope[k]);
        lag[k] = total;
    }
}

RoutedEdge routedEdgeState(float Q, float Qref, float H, float g) {
    if (!(Qref > 0.f) || !(H > 0.f) || !(g > 0.f)) return RoutedEdge{ 0.f, 0.f };
    if (!std::isfinite(Q) || !std::isfinite(Qref) || !std::isfinite(H) || !std::isfinite(g)) return RoutedEdge{ 0.f, 0.f };
    if (Q == Qref) return RoutedEdge{ 0.f, 0.f };
    const float ratio = std::max(Q, 0.f) / Qref;
    const float eta = std::clamp(H * (std::pow(ratio, ROUTING_RATING_EXPONENT) - 1.f), -0.9f * H, 2.f * H);
    const float speed = 2.f * (std::sqrt(g * (H + eta)) - std::sqrt(g * H));
    return RoutedEdge{ eta, speed };
}
