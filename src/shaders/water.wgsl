/**
 * water.wgsl — Water surface compute shader
 *
 * Updates a heightmap for water displacement, reconstructs normals from
 * the heightfield, and generates a foam mask based on wave curvature.
 *
 * DISPATCH: workgroup_size(8, 8, 1)
 * BUFFERS:
 *   - heightmap:     rgba32float storage texture (read/write)
 *   - normalmap:     rgba32float storage texture (write)
 *   - foamMask:      r32float storage texture (write)
 *   - params:        uniform buffer with time, deltaTime, waveSpeed, etc.
 *
 * This shader is designed for a future WebGPU compute path. It is exported
 * as a raw string from the TS module and not yet wired to a live WebGPU
 * device at runtime.
 */

struct WaterParams {
  time: f32,
  deltaTime: f32,
  waveSpeed: f32,
  waveAmplitude: f32,
  foamThreshold: f32,
  _padding: vec3<f32>,
};

@group(0) @binding(0) var heightmap: texture_storage_2d<rgba32float, read_write>;
@group(0) @binding(1) var normalmap: texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var foamMask: texture_storage_2d<r32float, write>;
@group(0) @binding(3) var<uniform> params: WaterParams;

const PI: f32 = 3.14159265359;

// Simplex-like hash for pseudo-random noise
fn hash2(p: vec2<f32>) -> f32 {
  let n: vec3<f32> = fract(vec3<f32>(p.xyx) * vec3<f32>(0.1031, 0.1030, 0.0973));
  n += dot(n, n.yzx + 33.33);
  return fract((n.x + n.y) * n.z);
}

fn noise2D(p: vec2<f32>) -> f32 {
  let i: vec2<f32> = floor(p);
  let f: vec2<f32> = fract(p);
  let a: f32 = hash2(i);
  let b: f32 = hash2(i + vec2<f32>(1.0, 0.0));
  let c: f32 = hash2(i + vec2<f32>(0.0, 1.0));
  let d: f32 = hash2(i + vec2<f32>(1.0, 1.0));
  let u: vec2<f32> = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2<f32>, octaves: i32) -> f32 {
  var value: f32 = 0.0;
  var amplitude: f32 = 0.5;
  var frequency: f32 = 1.0;
  for (var i: i32 = 0; i < octaves; i = i + 1) {
    value += amplitude * noise2D(p * frequency);
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let size: vec2<u32> = textureDimensions(heightmap);
  let coord: vec2<i32> = vec2<i32>(global_id.xy);

  if (coord.x >= i32(size.x) || coord.y >= i32(size.y)) {
    return;
  }

  let uv: vec2<f32> = vec2<f32>(coord) / vec2<f32>(size);

  // Sample current height
  let current: vec4<f32> = textureLoad(heightmap, coord);
  var height: f32 = current.r;

  // Displacement based on animated FBM
  let waveOffset: vec2<f32> = vec2<f32>(
    params.time * params.waveSpeed * 0.5,
    params.time * params.waveSpeed * 0.3
  );

  let displacement: f32 = fbm(uv * 8.0 + waveOffset, 4) * params.waveAmplitude;
  height = height + (displacement - current.g) * 0.3;

  // Store updated height + previous displacement for damping
  textureStore(heightmap, coord, vec4<f32>(height, displacement, current.b, current.a));

  // Reconstruct normal from heightfield neighbors
  let texel: vec2<f32> = 1.0 / vec2<f32>(size);

  var hL: f32 = 0.0;
  var hR: f32 = 0.0;
  var hD: f32 = 0.0;
  var hU: f32 = 0.0;

  let leftCoord: vec2<i32> = coord + vec2<i32>(-1, 0);
  let rightCoord: vec2<i32> = coord + vec2<i32>(1, 0);
  let downCoord: vec2<i32> = coord + vec2<i32>(0, -1);
  let upCoord: vec2<i32> = coord + vec2<i32>(0, 1);

  if (leftCoord.x >= 0) {
    hL = textureLoad(heightmap, leftCoord).r;
  } else {
    hL = height;
  }

  if (rightCoord.x < i32(size.x)) {
    hR = textureLoad(heightmap, rightCoord).r;
  } else {
    hR = height;
  }

  if (downCoord.y >= 0) {
    hD = textureLoad(heightmap, downCoord).r;
  } else {
    hD = height;
  }

  if (upCoord.y < i32(size.y)) {
    hU = textureLoad(heightmap, upCoord).r;
  } else {
    hU = height;
  }

  let normal: vec3<f32> = normalize(vec3<f32>(
    (hL - hR) * 0.5,
    1.0,
    (hD - hU) * 0.5
  ));

  // Pack normal into [0, 1] range for storage
  let packedNormal: vec3<f32> = normal * 0.5 + 0.5;
  textureStore(normalmap, coord, vec4<f32>(packedNormal, 1.0));

  // Foam mask: high curvature areas produce foam
  let curvature: f32 = abs(hL + hR + hU + hD - 4.0 * height);
  let foam: f32 = smoothstep(params.foamThreshold * 0.5, params.foamThreshold, curvature);
  textureStore(foamMask, coord, vec4<f32>(foam, 0.0, 0.0, 1.0));
}
