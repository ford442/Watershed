/**
 * flowmap.wgsl — Flow map advection compute shader
 *
 * Advects a 2D flow field forward in time using semi-Lagrangian advection.
 * Useful for animating water currents, foam drift, and particle flow fields.
 *
 * DISPATCH: workgroup_size(8, 8, 1)
 * BUFFERS:
 *   - flowFieldIn:   rg32float storage texture (read)
 *   - flowFieldOut:  rg32float storage texture (write)
 *   - params:        uniform buffer with time, deltaTime, dissipation, etc.
 *
 * This shader is designed for a future WebGPU compute path. It is exported
 * as a raw string from the TS module and not yet wired to a live WebGPU
 * device at runtime.
 */

struct FlowParams {
  time: f32,
  deltaTime: f32,
  dissipation: f32,
  noiseScale: f32,
  advectionSpeed: f32,
  _padding: vec3<f32>,
};

@group(0) @binding(0) var flowFieldIn: texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var flowFieldOut: texture_storage_2d<rg32float, write>;
@group(0) @binding(2) var<uniform> params: FlowParams;

const PI: f32 = 3.14159265359;

// Simplex-like hash
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

// Bilinear sample from the input flow field at fractional coordinates
fn sampleFlowField(uv: vec2<f32>, size: vec2<u32>) -> vec2<f32> {
  let fSize: vec2<f32> = vec2<f32>(size);
  let px: vec2<f32> = uv * fSize - 0.5;
  let base: vec2<i32> = vec2<i32>(floor(px));
  let frac: vec2<f32> = fract(px);

  let x0: i32 = clamp(base.x, 0, i32(size.x) - 1);
  let x1: i32 = clamp(base.x + 1, 0, i32(size.x) - 1);
  let y0: i32 = clamp(base.y, 0, i32(size.y) - 1);
  let y1: i32 = clamp(base.y + 1, 0, i32(size.y) - 1);

  let s00: vec4<f32> = textureLoad(flowFieldIn, vec2<i32>(x0, y0));
  let s10: vec4<f32> = textureLoad(flowFieldIn, vec2<i32>(x1, y0));
  let s01: vec4<f32> = textureLoad(flowFieldIn, vec2<i32>(x0, y1));
  let s11: vec4<f32> = textureLoad(flowFieldIn, vec2<i32>(x1, y1));

  let v00: vec2<f32> = s00.rg;
  let v10: vec2<f32> = s10.rg;
  let v01: vec2<f32> = s01.rg;
  let v11: vec2<f32> = s11.rg;

  return mix(
    mix(v00, v10, frac.x),
    mix(v01, v11, frac.x),
    frac.y
  );
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let size: vec2<u32> = textureDimensions(flowFieldIn);
  let coord: vec2<i32> = vec2<i32>(global_id.xy);

  if (coord.x >= i32(size.x) || coord.y >= i32(size.y)) {
    return;
  }

  let uv: vec2<f32> = (vec2<f32>(coord) + 0.5) / vec2<f32>(size);

  // Sample current flow
  let current: vec4<f32> = textureLoad(flowFieldIn, coord);
  var flow: vec2<f32> = current.rg;

  // Semi-Lagrangian backtrace: find where this pixel came from
  let backUV: vec2<f32> = uv - flow * params.advectionSpeed * params.deltaTime;
  let advected: vec2<f32> = sampleFlowField(backUV, size);

  // Blend advected value with current (damping / dissipation)
  flow = mix(advected, flow, params.dissipation * params.deltaTime);

  // Inject animated curl noise to keep flow from stagnating
  let noisePos: vec2<f32> = uv * params.noiseScale + vec2<f32>(params.time * 0.1, params.time * 0.07);
  let curlX: f32 = noise2D(noisePos + vec2<f32>(1.7, 3.2)) * 2.0 - 1.0;
  let curlY: f32 = noise2D(noisePos + vec2<f32>(4.1, 0.3)) * 2.0 - 1.0;

  let curl: vec2<f32> = vec2<f32>(curlX, curlY) * 0.02;
  flow = flow + curl * params.deltaTime;

  // Normalize to prevent runaway growth
  let speed: f32 = length(flow);
  if (speed > 1.0) {
    flow = flow / speed;
  }

  textureStore(flowFieldOut, coord, vec4<f32>(flow.x, flow.y, 0.0, 1.0));
}
