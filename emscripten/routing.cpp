/**
 * routing.cpp — kinematic-storage routing along the campaign chain.
 *
 * See routing.h for the scheme and the array layout. Scalar on purpose: this
 * is a few hundred reservoirs per call, not the Riemann fan.
 */

#include "routing.h"

#include <algorithm>
#include <cmath>

namespace {

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
    const float B = std::max(width, 0.5f);
    const float S = clampSlope(slope);
    return (5.f / 3.f) * std::pow(std::sqrt(S) / ROUTING_MANNING_N, 0.6f) * std::pow(B, -0.4f);
}

/**
 * Volume coefficient α with S = α · Q^0.6: the water a reach of length l
 * holds, l · B · y, with y from the same Manning rating.
 */
float volumeCoeff(float l, float width, float slope) {
    const float B = std::max(width, 0.5f);
    const float S = clampSlope(slope);
    return l * B * std::pow(ROUTING_MANNING_N / (B * std::sqrt(S)), 0.6f);
}

float storageFor(float Q, float alpha) {
    return alpha * std::pow(std::max(Q, 0.f), 0.6f);
}

/** Inverse of storageFor: Q = (S / α)^(5/3). */
float dischargeFor(float S, float alpha) {
    return std::pow(std::max(S, 0.f) / alpha, 5.f / 3.f);
}

}  // namespace

float routingCelerity(float Q, float width, float slope) {
    return celerityCoeff(width, slope) * std::pow(std::max(Q, 0.f), 0.4f);
}

void routeReachSteady(uintptr_t lengthsPtr, uintptr_t slopesPtr, uintptr_t widthsPtr, int nSeg,
                      float Q, uintptr_t storagePtr, uintptr_t outflowPtr) {
    if (nSeg <= 0 || lengthsPtr == 0 || slopesPtr == 0 || widthsPtr == 0) return;
    if (storagePtr == 0 || outflowPtr == 0) return;
    const float* L = reinterpret_cast<const float*>(lengthsPtr);
    const float* slope = reinterpret_cast<const float*>(slopesPtr);
    const float* B = reinterpret_cast<const float*>(widthsPtr);
    float* storage = reinterpret_cast<float*>(storagePtr);
    float* outflow = reinterpret_cast<float*>(outflowPtr);
    const float q = std::max(Q, 0.f);

    for (int k = 0; k < nSeg; ++k) {
        const float l = std::max(L[k], 1e-3f) / static_cast<float>(ROUTING_SUBREACHES);
        const float alpha = volumeCoeff(l, B[k], slope[k]);
        for (int j = 0; j < ROUTING_SUBREACHES; ++j) {
            storage[k * ROUTING_SUBREACHES + j] = storageFor(q, alpha);
        }
        outflow[k] = q;
    }
}

void routeReach(uintptr_t lengthsPtr, uintptr_t slopesPtr, uintptr_t widthsPtr, int nSeg,
                float inflowQ, float dt, uintptr_t storagePtr, uintptr_t outflowPtr) {
    if (nSeg <= 0 || lengthsPtr == 0 || slopesPtr == 0 || widthsPtr == 0) return;
    if (storagePtr == 0 || outflowPtr == 0) return;
    if (!(dt > 0.f)) return;
    const float* L = reinterpret_cast<const float*>(lengthsPtr);
    const float* slope = reinterpret_cast<const float*>(slopesPtr);
    const float* B = reinterpret_cast<const float*>(widthsPtr);
    float* storage = reinterpret_cast<float*>(storagePtr);
    float* outflow = reinterpret_cast<float*>(outflowPtr);

    // Mean inflow to the next reservoir over this step.
    float inflow = std::max(inflowQ, 0.f);
    for (int k = 0; k < nSeg; ++k) {
        const float l = std::max(L[k], 1e-3f) / static_cast<float>(ROUTING_SUBREACHES);
        const float alpha = volumeCoeff(l, B[k], slope[k]);
        for (int j = 0; j < ROUTING_SUBREACHES; ++j) {
            float& S = storage[k * ROUTING_SUBREACHES + j];
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
    if (nSeg <= 0 || lengthsPtr == 0 || slopesPtr == 0 || widthsPtr == 0 || lagPtr == 0) return;
    const float* L = reinterpret_cast<const float*>(lengthsPtr);
    const float* slope = reinterpret_cast<const float*>(slopesPtr);
    const float* B = reinterpret_cast<const float*>(widthsPtr);
    float* lag = reinterpret_cast<float*>(lagPtr);
    const float q = std::max(Q, ROUTING_MIN_DISCHARGE);

    float total = 0.f;
    for (int k = 0; k < nSeg; ++k) {
        total += std::max(L[k], 1e-3f) / routingCelerity(q, B[k], slope[k]);
        lag[k] = total;
    }
}

RoutedEdge routedEdgeState(float Q, float Qref, float H, float g) {
    if (!(Qref > 0.f) || !(H > 0.f) || !(g > 0.f) || !std::isfinite(Q)) return RoutedEdge{ 0.f, 0.f };
    if (Q == Qref) return RoutedEdge{ 0.f, 0.f };
    const float ratio = std::max(Q, 0.f) / Qref;
    const float eta = std::clamp(H * (std::pow(ratio, ROUTING_RATING_EXPONENT) - 1.f), -0.9f * H, 2.f * H);
    const float speed = 2.f * (std::sqrt(g * (H + eta)) - std::sqrt(g * H));
    return RoutedEdge{ eta, speed };
}
