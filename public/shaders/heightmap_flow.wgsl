/**
 * DORMANT / EXPERIMENTAL WebGPU compute shader — not wired into the live renderer.
 * Fetched at runtime by src/shaders/HeightmapFlow.ts as an optional compute path.
 * The game renderer remains WebGL2-only. See docs/RENDERER_CONTRACT.md.
 */

struct HeightmapFlowParams {
  texelSize: vec2<f32>,
  deltaTime: f32,
  flowStrength: f32,
  viscosity: f32,
  normalStrength: f32,
  gravity: f32,
  elapsedTime: f32,
};

@group(0) @binding(0) var<uniform> params: HeightmapFlowParams;
@group(0) @binding(1) var heightInput: texture_2d<f32>;
@group(0) @binding(2) var flowInput: texture_2d<f32>;
@group(0) @binding(3) var heightOutput: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var flowOutput: texture_storage_2d<rgba32float, write>;

fn clampCoord(coord: vec2<i32>, size: vec2<u32>) -> vec2<i32> {
  return clamp(coord, vec2<i32>(0), vec2<i32>(size) - vec2<i32>(1));
}

fn heightAt(coord: vec2<i32>, size: vec2<u32>) -> f32 {
  return textureLoad(heightInput, clampCoord(coord, size), 0).r;
}

fn flowAt(coord: vec2<i32>, size: vec2<u32>) -> vec2<f32> {
  return textureLoad(flowInput, clampCoord(coord, size), 0).rg * 2.0 - vec2<f32>(1.0);
}

fn reconstructNormal(coord: vec2<i32>, size: vec2<u32>) -> vec3<f32> {
  let hL = heightAt(coord + vec2<i32>(-1, 0), size);
  let hR = heightAt(coord + vec2<i32>(1, 0), size);
  let hD = heightAt(coord + vec2<i32>(0, -1), size);
  let hU = heightAt(coord + vec2<i32>(0, 1), size);
  let slope = vec2<f32>(hR - hL, hU - hD) * params.normalStrength;
  return normalize(vec3<f32>(-slope.x, 1.0, -slope.y));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let size = textureDimensions(heightInput);
  if (globalId.x >= size.x || globalId.y >= size.y) {
    return;
  }

  let coord = vec2<i32>(globalId.xy);
  let centerHeight = heightAt(coord, size);
  let currentFlow = flowAt(coord, size);

  let hL = heightAt(coord + vec2<i32>(-1, 0), size);
  let hR = heightAt(coord + vec2<i32>(1, 0), size);
  let hD = heightAt(coord + vec2<i32>(0, -1), size);
  let hU = heightAt(coord + vec2<i32>(0, 1), size);
  let gradient = vec2<f32>(hL - hR, hD - hU) * 0.5;

  let gravityFlow = gradient * params.gravity * params.flowStrength;
  let downstream = vec2<f32>(0.0, -params.flowStrength);
  let dampedFlow = currentFlow * max(0.0, 1.0 - params.viscosity * params.deltaTime);
  let nextFlow = clamp(dampedFlow + (gravityFlow + downstream) * params.deltaTime, vec2<f32>(-1.0), vec2<f32>(1.0));

  let backTrace = vec2<f32>(coord) - nextFlow * params.deltaTime * 12.0;
  let advectCoord = clampCoord(vec2<i32>(round(backTrace)), size);
  let advectedHeight = heightAt(advectCoord, size);

  let laplacian = (hL + hR + hD + hU - centerHeight * 4.0);
  let nextHeight = clamp(
    mix(centerHeight, advectedHeight, clamp(params.flowStrength * params.deltaTime, 0.0, 1.0))
      + laplacian * params.viscosity * params.deltaTime,
    0.0,
    1.0
  );

  let normal = reconstructNormal(coord, size) * 0.5 + vec3<f32>(0.5);
  textureStore(heightOutput, coord, vec4<f32>(nextHeight, normal));
  textureStore(flowOutput, coord, vec4<f32>(nextFlow * 0.5 + vec2<f32>(0.5), length(nextFlow), 1.0));
}
