/**
 * Inline WGSL for gpu-chores. Domain flow stays in
 * `public/shaders/heightmap_flow.wgsl` — these kernels are generic image/grid helpers.
 *
 * Workgroups: (64) 1D reduce; (8, 8) 2D hist / downsample / blur.
 */

export const REDUCE_WGSL = /* wgsl */ `
struct ReduceUniforms {
  width: u32,
  height: u32,
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var heightTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outBuf: array<f32>;
@group(0) @binding(2) var<uniform> uniforms: ReduceUniforms;

var<workgroup> wgMin: array<f32, 64>;
var<workgroup> wgMax: array<f32, 64>;
var<workgroup> wgSum: array<f32, 64>;
var<workgroup> wgCount: array<u32, 64>;

@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) li: u32) {
  let count = uniforms.width * uniforms.height;
  var localMin = 3.402823e+38;
  var localMax = -3.402823e+38;
  var localSum = 0.0;
  var localCount = 0u;
  var i = li;
  loop {
    if (i >= count) { break; }
    let x = i % uniforms.width;
    let y = i / uniforms.width;
    let v = textureLoad(heightTex, vec2<i32>(i32(x), i32(y)), 0).r;
    if (v == v) {
      localMin = min(localMin, v);
      localMax = max(localMax, v);
      localSum = localSum + v;
      localCount = localCount + 1u;
    }
    i = i + 64u;
  }
  wgMin[li] = localMin;
  wgMax[li] = localMax;
  wgSum[li] = localSum;
  wgCount[li] = localCount;
  workgroupBarrier();

  var stride = 32u;
  loop {
    if (stride == 0u) { break; }
    if (li < stride) {
      wgMin[li] = min(wgMin[li], wgMin[li + stride]);
      wgMax[li] = max(wgMax[li], wgMax[li + stride]);
      wgSum[li] = wgSum[li] + wgSum[li + stride];
      wgCount[li] = wgCount[li] + wgCount[li + stride];
    }
    workgroupBarrier();
    stride = stride / 2u;
  }

  if (li == 0u) {
    let n = wgCount[0];
    outBuf[0] = select(0.0, wgMin[0], n > 0u);
    outBuf[1] = select(0.0, wgMax[0], n > 0u);
    outBuf[2] = select(0.0, wgSum[0] / f32(n), n > 0u);
  }
}
`;

export const HISTOGRAM_WGSL = /* wgsl */ `
struct HistUniforms {
  width: u32,
  height: u32,
  rangeMin: f32,
  rangeMax: f32,
};

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> uniforms: HistUniforms;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= uniforms.width || gid.y >= uniforms.height) { return; }
  let v = textureLoad(srcTex, vec2<i32>(i32(gid.x), i32(gid.y)), 0).r;
  if (v != v) { return; }
  let span = uniforms.rangeMax - uniforms.rangeMin;
  var bin = 0u;
  if (span > 0.0) {
    let t = (v - uniforms.rangeMin) / span * 256.0;
    bin = u32(clamp(i32(floor(t)), 0, 255));
  }
  atomicAdd(&bins[bin], 1u);
}
`;

export const DOWNSAMPLE_WGSL = /* wgsl */ `
struct DownsampleUniforms {
  srcW: u32,
  srcH: u32,
  dstW: u32,
  dstH: u32,
};

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> dest: array<f32>;
@group(0) @binding(2) var<uniform> uniforms: DownsampleUniforms;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= uniforms.dstW || gid.y >= uniforms.dstH) { return; }
  var y0 = (gid.y * uniforms.srcH) / uniforms.dstH;
  var y1 = ((gid.y + 1u) * uniforms.srcH) / uniforms.dstH;
  if (y1 <= y0) { y1 = min(uniforms.srcH, y0 + 1u); }
  var x0 = (gid.x * uniforms.srcW) / uniforms.dstW;
  var x1 = ((gid.x + 1u) * uniforms.srcW) / uniforms.dstW;
  if (x1 <= x0) { x1 = min(uniforms.srcW, x0 + 1u); }
  var sum = 0.0;
  var n = 0u;
  var y = y0;
  loop {
    if (y >= y1) { break; }
    var x = x0;
    loop {
      if (x >= x1) { break; }
      let v = textureLoad(srcTex, vec2<i32>(i32(x), i32(y)), 0).r;
      if (v == v) {
        sum = sum + v;
        n = n + 1u;
      }
      x = x + 1u;
    }
    y = y + 1u;
  }
  dest[gid.y * uniforms.dstW + gid.x] = select(0.0, sum / f32(n), n > 0u);
}
`;

export const BLUR_H_WGSL = /* wgsl */ `
struct BlurUniforms {
  width: u32,
  height: u32,
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> dest: array<f32>;
@group(0) @binding(2) var<uniform> uniforms: BlurUniforms;

fn sample(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(uniforms.width) - 1);
  let cy = clamp(y, 0, i32(uniforms.height) - 1);
  return textureLoad(srcTex, vec2<i32>(cx, cy), 0).r;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= uniforms.width || gid.y >= uniforms.height) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  dest[gid.y * uniforms.width + gid.x] =
    sample(x - 1, y) * 0.25 + sample(x, y) * 0.5 + sample(x + 1, y) * 0.25;
}
`;
