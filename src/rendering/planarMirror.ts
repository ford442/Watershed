/**
 * planarMirror — the virtual camera for a horizontal planar reflection.
 *
 * The math is three's `Reflector` / TSL `ReflectorNode`: reflect the camera's
 * position, look target and up vector through the plane, copy the projection,
 * then replace its near plane with the mirror plane (Lengyel's oblique
 * frustum). Clipping through the projection instead of `renderer.clippingPlanes`
 * is what makes the reflection identical on both renderers: the node
 * `Renderer` has no global clipping planes, so a clip plane set there was
 * silently ignored on `?material=tsl` (#466 follow-up, bug 2c).
 *
 * Handedness: a camera built from reflected position / target / up is a proper
 * rotation, so its image is the true mirror image flipped left↔right about the
 * screen centre (its right axis is the reflected right axis, negated). The
 * water shaders sample the reflection at the *main* camera's screen position,
 * so they must read it at `u' = 1 − u` — exact for any symmetric projection,
 * oblique near plane included (that only rewrites the z row). See
 * `mirroredReflectionU`.
 *
 * Pure: three math only, scratch objects hoisted, no allocation per call.
 */

import * as THREE from 'three';

const _normal = new THREE.Vector3(0, 1, 0);
const _planePoint = new THREE.Vector3();
const _cameraWorld = new THREE.Vector3();
const _view = new THREE.Vector3();
const _rotation = new THREE.Matrix4();
const _lookAt = new THREE.Vector3();
const _target = new THREE.Vector3();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();
const _corner = new THREE.Vector3();

/**
 * Point `virtual` at the mirror image of `camera` through the horizontal plane
 * `y = planeY`, with the plane as its near clip. Returns false (and leaves
 * `virtual` untouched) when the camera is at or below the plane — the
 * reflection faces away and must not render.
 *
 * `camera.matrixWorld` and `camera.projectionMatrix` must be current.
 */
export function updateMirrorCamera(
  camera: THREE.PerspectiveCamera,
  virtual: THREE.PerspectiveCamera,
  planeY: number,
): boolean {
  _cameraWorld.setFromMatrixPosition(camera.matrixWorld);
  if (!(_cameraWorld.y > planeY)) return false;

  // Plane point under the camera: keeps the reflection math well-conditioned
  // however far the treadmill has carried the camera from the origin.
  _planePoint.set(_cameraWorld.x, planeY, _cameraWorld.z);

  _view.subVectors(_planePoint, _cameraWorld).reflect(_normal).negate().add(_planePoint);

  _rotation.extractRotation(camera.matrixWorld);
  _lookAt.set(0, 0, -1).applyMatrix4(_rotation).add(_cameraWorld);
  _target.subVectors(_planePoint, _lookAt).reflect(_normal).negate().add(_planePoint);

  virtual.coordinateSystem = camera.coordinateSystem;
  virtual.position.copy(_view);
  virtual.up.set(0, 1, 0).applyMatrix4(_rotation).reflect(_normal);
  virtual.lookAt(_target);
  // Kept in step so a renderer that rebuilds the projection (coordinate-system
  // change) lands on the same frustum before we overwrite it below.
  virtual.fov = camera.fov;
  virtual.aspect = camera.aspect;
  virtual.near = camera.near;
  virtual.far = camera.far;
  virtual.updateMatrixWorld();
  virtual.projectionMatrix.copy(camera.projectionMatrix);

  // Oblique near plane = the mirror plane, in the virtual camera's view space.
  _plane.setFromNormalAndCoplanarPoint(_normal, _planePoint).applyMatrix4(virtual.matrixWorldInverse);
  _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);

  const e = virtual.projectionMatrix.elements;
  _q.set(
    (Math.sign(_clip.x) + e[8]) / e[0],
    (Math.sign(_clip.y) + e[9]) / e[5],
    -1,
    (1 + e[10]) / e[14],
  );
  const webgpuDepth = camera.coordinateSystem === THREE.WebGPUCoordinateSystem;
  // NDC z in [-1, 1] (WebGL): near row = 2C/(C·q) − row 4. In [0, 1] (WebGPU): C/(C·q).
  _clip.multiplyScalar((webgpuDepth ? 1 : 2) / _clip.dot(_q));
  e[2] = _clip.x;
  e[6] = _clip.y;
  e[10] = webgpuDepth ? _clip.z : _clip.z + 1;
  e[14] = _clip.w;
  virtual.projectionMatrixInverse.copy(virtual.projectionMatrix).invert();
  return true;
}

/** Map a main-camera screen u onto the mirror camera's render target (see header). */
export function mirroredReflectionU(u: number): number {
  return 1 - u;
}

/**
 * Whether any of the camera frustum's eight corners lies below `planeY` — i.e.
 * the water plane can be on screen at all. A camera looking up at the canyon
 * rim (or one with no water datum under it) skips the reflection render.
 */
export function frustumReachesBelow(camera: THREE.Camera, planeY: number): boolean {
  const nearZ = camera.coordinateSystem === THREE.WebGPUCoordinateSystem ? 0 : -1;
  for (let i = 0; i < 8; i += 1) {
    _corner
      .set(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : nearZ)
      .applyMatrix4(camera.projectionMatrixInverse)
      .applyMatrix4(camera.matrixWorld);
    if (_corner.y < planeY) return true;
  }
  return false;
}
