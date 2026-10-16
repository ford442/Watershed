/**
 * sceneLightPool — lights that segment content borrows instead of mounting (#487 Phase B).
 *
 * three.js bakes the number of lights of each kind into every lit program
 * (NUM_POINT_LIGHTS, NUM_HEMI_LIGHTS). A treadmill segment that mounted its own
 * <pointLight> (firefly glow, waterfall spray) or <hemisphereLight> (slot
 * canyon fill) changed that number, and the next frame recompiled every lit
 * material in the scene: ~37 program links per segment append, most of a
 * mount's main-thread time (verification/spawn_profile.mjs). Segment content
 * now asks this pool, whose light count never changes:
 *
 * - POINT_LIGHT_POOL_SIZE point lights, always mounted, handed each frame to
 *   the brightest-at-the-camera requests (intensity over squared distance);
 *   the rest sit at intensity 0. A firefly 200 m away lit nothing anyway — its
 *   light has a 3 m range.
 * - One slot-canyon fill hemisphere at 0.55 × (slot segments mounted).
 *   Hemisphere irradiance adds, so this is exactly the light the per-segment
 *   copies summed to.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

/** Point lights the pool keeps mounted. */
export const POINT_LIGHT_POOL_SIZE = 6;

/** The slot canyon's warm bounce fill, per mounted slot segment. */
export const SLOT_CANYON_FILL = { color: '#ff8c4a', groundColor: '#3d1a0a', intensity: 0.55 } as const;

/** One borrowed point light. The owner writes it every frame; world space. */
export interface PointLightRequest {
  readonly position: THREE.Vector3;
  readonly color: THREE.Color;
  intensity: number;
  distance: number;
  decay: number;
}

const requests = new Set<PointLightRequest>();
let slotCanyonSegments = 0;

/** Live requests (tests / the pool). */
export function pointLightRequests(): ReadonlySet<PointLightRequest> {
  return requests;
}

/** Slot segments currently mounted (tests / the pool). */
export function slotCanyonFillCount(): number {
  return slotCanyonSegments;
}

/**
 * Borrow `count` point lights while mounted. Requests start at intensity 0;
 * the caller sets position (world) and intensity in its own useFrame.
 */
export function usePooledPointLights(
  count: number,
  init: { color: THREE.ColorRepresentation; distance: number; decay: number },
): PointLightRequest[] {
  const { color, distance, decay } = init;
  const lights = useMemo(
    () =>
      Array.from({ length: Math.max(0, count) }, () => ({
        position: new THREE.Vector3(),
        color: new THREE.Color(color),
        intensity: 0,
        distance,
        decay,
      })),
    [count, color, distance, decay],
  );
  useEffect(() => {
    for (const light of lights) requests.add(light);
    return () => {
      for (const light of lights) requests.delete(light);
    };
  }, [lights]);
  return lights;
}

/** Count this slot-canyon segment into the shared fill while mounted. */
export function useSlotCanyonFill(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    slotCanyonSegments += 1;
    return () => {
      slotCanyonSegments -= 1;
    };
  }, [active]);
}

/** Per-frame scratch for `selectPointLights` (no allocation on the frame path). */
const scoreScratch: number[] = [];

/**
 * Pick which requests get the pool's lights: the `size` with the largest
 * intensity / distance² at `eye`, skipping dark ones, best first. Writes into
 * `out` (reused) and returns how many were picked.
 */
export function selectPointLights(
  candidates: Iterable<PointLightRequest>,
  eye: THREE.Vector3,
  size: number,
  out: PointLightRequest[],
): number {
  let n = 0;
  if (size <= 0) {
    out.length = 0;
    return 0;
  }
  for (const request of candidates) {
    if (!(request.intensity > 0)) continue;
    const score = request.intensity / Math.max(1, request.position.distanceToSquared(eye));
    if (n === size && scoreScratch[n - 1] >= score) continue;
    // Insertion into the sorted top-`size` list.
    let at = n < size ? n++ : size - 1;
    while (at > 0 && scoreScratch[at - 1] < score) {
      scoreScratch[at] = scoreScratch[at - 1];
      out[at] = out[at - 1];
      at -= 1;
    }
    scoreScratch[at] = score;
    out[at] = request;
  }
  out.length = n;
  return n;
}

/** The pool's lights. Mounted once, with the scene lighting. */
export function SceneLightPool() {
  const pointRefs = useRef<(THREE.PointLight | null)[]>([]);
  const fillRef = useRef<THREE.HemisphereLight>(null);
  const picked = useMemo<PointLightRequest[]>(() => [], []);

  useFrame(({ camera }) => {
    const n = selectPointLights(requests, camera.position, POINT_LIGHT_POOL_SIZE, picked);
    for (let i = 0; i < POINT_LIGHT_POOL_SIZE; i += 1) {
      const light = pointRefs.current[i];
      if (!light) continue;
      const request = i < n ? picked[i] : null;
      if (!request) {
        light.intensity = 0;
        continue;
      }
      light.position.copy(request.position);
      light.color.copy(request.color);
      light.intensity = request.intensity;
      light.distance = request.distance;
      light.decay = request.decay;
    }
    if (fillRef.current) fillRef.current.intensity = SLOT_CANYON_FILL.intensity * slotCanyonSegments;
  });

  return (
    <>
      {Array.from({ length: POINT_LIGHT_POOL_SIZE }, (_, i) => (
        <pointLight
          key={i}
          ref={(light) => {
            pointRefs.current[i] = light;
          }}
          intensity={0}
        />
      ))}
      <hemisphereLight
        ref={fillRef}
        color={SLOT_CANYON_FILL.color}
        groundColor={SLOT_CANYON_FILL.groundColor}
        intensity={0}
      />
    </>
  );
}
