import * as THREE from 'three';

const HIDDEN_POSITION = new THREE.Vector3(0, -1000, 0);

const seededRandom = (seed) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

const isFiniteVector = (value) => (
  value &&
  Number.isFinite(value.x) &&
  Number.isFinite(value.y) &&
  Number.isFinite(value.z)
);

export class ObstaclePool {
  constructor(size = 16) {
    this.size = Math.max(12, Math.min(16, size));
    this.slots = Array.from({ length: this.size }, (_, index) => ({
      poolIndex: index,
      active: false,
      key: null,
      segmentId: null,
      type: 'rock',
      position: HIDDEN_POSITION.clone(),
      rotation: new THREE.Euler(),
      scale: new THREE.Vector3(1, 1, 1),
      colliderHalfExtents: new THREE.Vector3(0.8, 0.5, 0.8),
    }));
  }

  getSnapshot() {
    return this.slots.map((slot) => ({
      ...slot,
      position: slot.position.clone(),
      rotation: slot.rotation.clone(),
      scale: slot.scale.clone(),
      colliderHalfExtents: slot.colliderHalfExtents.clone(),
    }));
  }

  getPooledObstacle(type, position, options = {}) {
    if (!isFiniteVector(position)) return null;

    const key = options.key ?? `${options.segmentId ?? 'manual'}:${type}:${position.x.toFixed(1)}:${position.z.toFixed(1)}`;
    const existing = this.slots.find((slot) => slot.active && slot.key === key);
    const slot = existing ?? this.slots.find((candidate) => !candidate.active);
    if (!slot) return null;

    const scale = options.scale instanceof THREE.Vector3
      ? options.scale
      : new THREE.Vector3(options.scale ?? 1, options.scale ?? 1, options.scale ?? 1);

    slot.active = true;
    slot.key = key;
    slot.segmentId = options.segmentId ?? null;
    slot.type = type;
    slot.position.copy(position);
    slot.rotation.copy(options.rotation ?? new THREE.Euler());
    slot.scale.copy(scale);
    slot.colliderHalfExtents.copy(
      options.colliderHalfExtents ?? (
        type === 'log'
          ? new THREE.Vector3(1.45 * scale.x, 0.22 * scale.y, 0.28 * scale.z)
          : new THREE.Vector3(0.65 * scale.x, 0.45 * scale.y, 0.65 * scale.z)
      )
    );

    return slot;
  }

  syncSegments(segments = []) {
    const desired = [];
    for (const segment of segments) {
      desired.push(...buildSegmentObstacleRequests(segment));
    }

    const desiredKeys = new Set(desired.map((request) => request.key));
    for (const slot of this.slots) {
      if (slot.active && !desiredKeys.has(slot.key)) {
        this.releaseSlot(slot);
      }
    }

    for (const request of desired) {
      this.getPooledObstacle(request.type, request.position, request);
    }

    return this.getSnapshot();
  }

  releaseSegment(segmentId) {
    for (const slot of this.slots) {
      if (slot.segmentId === segmentId) {
        this.releaseSlot(slot);
      }
    }
  }

  releaseSlot(slot) {
    slot.active = false;
    slot.key = null;
    slot.segmentId = null;
    slot.position.copy(HIDDEN_POSITION);
    slot.rotation.set(0, 0, 0);
    slot.scale.set(1, 1, 1);
    slot.colliderHalfExtents.set(0.1, 0.1, 0.1);
  }
}

export function buildSegmentObstacleRequests(segment) {
  if (!segment?.segmentPath) return [];

  const requests = [];
  const highDensity = segment.rockDensity === 'high' || segment.flowSpeed >= 1.25 || segment.type === 'waterfall';
  const isPond = segment.type === 'pond' || segment.type === 'splash';
  const count = highDensity ? 3 : isPond ? 1 : 2;
  const waterWidth = segment.waterWidth ?? 12;
  const canyonWidth = segment.width ?? 35;

  for (let index = 0; index < count; index += 1) {
    const seed = segment.id * 911 + index * 73;
    const t = THREE.MathUtils.clamp(0.24 + index * 0.24 + seededRandom(seed) * 0.08, 0.08, 0.92);
    const point = segment.segmentPath.getPoint(t);
    const tangent = segment.segmentPath.getTangent(t).normalize();
    const lateral = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0));
    if (lateral.lengthSq() < 1e-6) lateral.set(1, 0, 0);
    lateral.normalize();

    const side = seededRandom(seed + 3) > 0.5 ? 1 : -1;
    const bankOffset = Math.min(canyonWidth * 0.44, waterWidth * 0.5 + 1.1 + seededRandom(seed + 7) * 3.2);
    const position = point.clone().add(lateral.multiplyScalar(side * bankOffset));
    position.y += segment.type === 'waterfall' ? 0.6 : 0.25 + seededRandom(seed + 11) * 0.5;

    const type = isPond && index === 0 ? 'log' : 'rock';
    const yaw = Math.atan2(tangent.x, tangent.z) + (seededRandom(seed + 17) - 0.5) * Math.PI;
    const scaleValue = type === 'log'
      ? 0.85 + seededRandom(seed + 19) * 0.35
      : 0.85 + seededRandom(seed + 23) * (highDensity ? 0.9 : 0.55);

    requests.push({
      key: `${segment.id}:${type}:${index}`,
      segmentId: segment.id,
      type,
      position,
      rotation: type === 'log'
        ? new THREE.Euler(0, yaw, Math.PI / 2)
        : new THREE.Euler(seededRandom(seed + 29) * 0.4, yaw, seededRandom(seed + 31) * 0.35),
      scale: new THREE.Vector3(scaleValue, scaleValue, scaleValue),
    });
  }

  return requests;
}

export function createObstaclePool(size) {
  return new ObstaclePool(size);
}

export function getPooledObstacle(pool, type, position, options = {}) {
  return pool?.getPooledObstacle?.(type, position, options) ?? null;
}
