/**
 * routing.h — 1D channel routing along the campaign chain (ABI 10, additive).
 *
 * The SWE window is ~24 m of river. Upstream of it sits the rest of the basin
 * (glacial → lumber → meander → hydro → delta), which this module reduces to
 * one number per segment: the discharge Q (m³/s) leaving it. A launch-hour
 * hydrograph enters at the chain head and is carried down with a travel time,
 * and the routed discharge at the player's segment sets the SWE window's
 * upstream edge (`stepShallowWaterInflow`, swe.h). It is not a second 2D grid.
 *
 * Scheme — kinematic storage: each segment is ROUTING_SUBREACHES reservoirs in
 * series. A reservoir of length l holds the kinematic-wave storage
 *
 *     S = l · Q / c(Q),   c = (5/3) V,   V from Manning on a wide rectangle,
 *
 * so S ∝ Q^0.6 and a crest travels at the kinematic celerity, faster than the
 * water under it. Each step freezes K = S / Q for the step and integrates the
 * linear reservoir dS/dt = I − S/K exactly, which is unconditionally stable for
 * any dt and returns exactly the volume it does not keep:
 *
 *     outflow volume = I·dt − (S' − S)
 *
 * Volume is therefore conserved to float round-off; the cascade diffuses a
 * step (it may flatten a pulse) but never gains volume.
 *
 * Arrays are caller-owned WASM heap floats (allocateGrid), like the SWE grid:
 *   lengths[nSeg]   segment length along the centreline (m)
 *   slopes[nSeg]    bed slope (m/m), clamped here to [ROUTING_MIN_SLOPE, ROUTING_MAX_SLOPE]
 *   widths[nSeg]    wetted width (m)
 *   storage[nSeg * ROUTING_SUBREACHES]   reservoir state (m³), owned by routeReach
 *   outflow[nSeg]   mean discharge leaving each segment over the last step (m³/s)
 *
 * Embind-free; bindings.cpp registers the surface.
 */

#ifndef WATERSHED_ROUTING_H
#define WATERSHED_ROUTING_H

#include "common.h"
#include <cstdint>

/** Reservoirs per segment. More sharpen the front; 4 keeps a ~100 m segment's lag crisp. */
static constexpr int ROUTING_SUBREACHES = 4;
/** Manning roughness of a cobble mountain channel (s/m^(1/3)). */
static constexpr float ROUTING_MANNING_N = 0.035f;
/** Slope clamp: a pond is not flat to the solver, a waterfall is not a free fall. */
static constexpr float ROUTING_MIN_SLOPE = 0.002f;
static constexpr float ROUTING_MAX_SLOPE = 0.25f;
/** Discharge floor for the reservoir time constant, so an empty reach has a finite K. */
static constexpr float ROUTING_MIN_DISCHARGE = 1e-3f;
/** Stage → discharge rating exponent (Manning, wide channel: y ∝ Q^0.6). */
static constexpr float ROUTING_RATING_EXPONENT = 0.6f;

/** Upstream-edge state handed to the SWE window for one routed discharge. */
struct RoutedEdge {
    /** Free-surface perturbation at the edge (m) — the swe.h `h` convention. */
    float eta;
    /** Downstream (−Z) speed of the simple wave carrying that stage in (m/s), over a zero bed. */
    float speed;
};

/** Kinematic-wave celerity (m/s) for discharge Q in a segment of the given width and slope. */
float routingCelerity(float Q, float width, float slope);

/** Fill storage / outflow with the steady state that carries Q through every segment. */
void routeReachSteady(uintptr_t lengthsPtr, uintptr_t slopesPtr, uintptr_t widthsPtr, int nSeg,
                      float Q, uintptr_t storagePtr, uintptr_t outflowPtr);

/**
 * Advance the chain by dt seconds with `inflowQ` entering the head segment.
 * Reservoirs are visited upstream → downstream, so a step's outflow feeds the
 * next reservoir as its mean inflow over the same step.
 */
void routeReach(uintptr_t lengthsPtr, uintptr_t slopesPtr, uintptr_t widthsPtr, int nSeg,
                float inflowQ, float dt, uintptr_t storagePtr, uintptr_t outflowPtr);

/**
 * Cumulative kinematic travel time (s) from the chain head to the downstream
 * end of each segment, for a steady discharge Q. lag[k] is the routed delay a
 * change at the head takes to reach segment k's outflow.
 */
void routeReachTravelTime(uintptr_t lengthsPtr, uintptr_t slopesPtr, uintptr_t widthsPtr, int nSeg,
                          float Q, uintptr_t lagPtr);

/**
 * Edge state for a routed discharge, relative to the reference discharge Qref
 * the window's still water H stands for:
 *
 *     eta   = H · ((Q / Qref)^0.6 − 1)            (Manning rating)
 *     speed = 2 · (√(g(H + eta)) − √(gH))          (simple wave into still water)
 *
 * Q == Qref gives exactly (0, 0), so a reference-flow hour leaves the window
 * at rest. eta is clamped to [−0.9 H, 2 H].
 */
RoutedEdge routedEdgeState(float Q, float Qref, float H, float g);

#endif  // WATERSHED_ROUTING_H
