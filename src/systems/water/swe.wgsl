// swe.wgsl — WGSL twin of emscripten/swe.cpp (stepShallowWater + applySWEEvent, ABI 8).
//
// Same numerics, not a new water sim: Audusse hydrostatic reconstruction + HLL
// flux, transmissive boundaries, wetting/drying, CFL clamp, velocity damping.
// Field conventions are the ABI in swe.h — `h` is the free-surface perturbation
// η (0 at rest), `b` the bed above the channel-floor datum, depth = H + η − b.
// All fields are f32 SoA, row-major, index = z * width + x.
//
// The C++ scatters each face flux into both neighbours. Here every cell gathers
// its own four faces instead (no write races), in the order the C++ loops
// accumulate them — left x-face, right x-face, lower z-face, upper z-face — so
// the float sums round the same way. The Riemann solver stays scalar, as it
// does in the C++ (SIMD there is only lift / CFL max / damping).
//
// Buffers are packed so the kernels need three storage bindings — well inside
// even compatibility-mode limits:
//   field    [h | u | w | b]           4N f32, the simulation state (read back)
//   scratch  [d | d·u | d·w]           3N f32; before `add_surface` its first N
//                                       floats carry the splash delta
//   maxBits  CFL max wave speed as u32 bits
//
// Entry points, one dispatch each, in step order:
//   add_surface  h += scratch[0..N)      (queued splash disturbances)
//   lift         (η,u,w) → (d, d·u, d·w) scratch + global max wave speed
//   update       gather fluxes, apply, lower back to (η,u,w), damp
//   events       authored hydro source terms (applySWEEvent), in authored order

const DRY_DEPTH: f32 = 1e-4;       // SWE_DRY_DEPTH (swe.cpp)
const CFL_NUMBER: f32 = 0.4;       // kCflNumber
const DAMPING_COEFF: f32 = 0.1;    // common.h
const HYDRO_INFLOW_DOWNSTREAM: f32 = 0.5;
const HYDRO_VORTEX_SINK: f32 = 0.35;
const HYDRO_BRAID_LATERAL: f32 = 0.75;

struct Params {
  width: u32,
  height: u32,
  count: u32,
  eventCount: u32,
  dt: f32,
  g: f32,
  dx: f32,
  H: f32,
  originX: f32,
  originZ: f32,
  _pad0: f32,
  _pad1: f32,
};

// kind: 0 inflow, 1 vortex, 2 braid, 3 roughness (hydroEvents.ts HYDRO_KIND_*).
struct HydroEvent {
  kind: i32,
  cx: f32,
  cz: f32,
  radius: f32,
  strength: f32,
  dt: f32,
  _pad0: f32,
  _pad1: f32,
};

/** Events per dispatch; the host splits longer lists into several dispatches. */
const MAX_EVENTS: u32 = 32u;

struct EventBlock {
  items: array<HydroEvent, 32>,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> field: array<f32>;
@group(0) @binding(2) var<storage, read_write> scratch: array<f32>;
@group(0) @binding(3) var<storage, read_write> maxSpeedBits: array<atomic<u32>, 1>;
@group(0) @binding(4) var<uniform> events: EventBlock;

// Field / scratch accessors: SoA planes inside one buffer each.
fn hAt(i: u32) -> f32 { return field[i]; }
fn uAt(i: u32) -> f32 { return field[params.count + i]; }
fn wAt(i: u32) -> f32 { return field[2u * params.count + i]; }
fn bAt(i: u32) -> f32 { return field[3u * params.count + i]; }
fn setH(i: u32, v: f32) { field[i] = v; }
fn setU(i: u32, v: f32) { field[params.count + i] = v; }
fn setW(i: u32, v: f32) { field[2u * params.count + i] = v; }
fn setB(i: u32, v: f32) { field[3u * params.count + i] = v; }
fn dAt(i: u32) -> f32 { return scratch[i]; }
fn qxAt(i: u32) -> f32 { return scratch[params.count + i]; }
fn qzAt(i: u32) -> f32 { return scratch[2u * params.count + i]; }

const WORKGROUP: u32 = 64u;

// ── add_surface ──────────────────────────────────────────────────────────────
@compute @workgroup_size(64)
fn add_surface(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.count) { return; }
  setH(i, hAt(i) + scratch[i]);
}

// ── lift + CFL max ───────────────────────────────────────────────────────────
var<workgroup> wgMax: array<f32, 64>;

@compute @workgroup_size(64)
fn lift(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let i = gid.x;
  var speed = 0.0;
  if (i < params.count) {
    let n = params.count;
    let depth = max(0.0, (params.H + hAt(i)) - bAt(i));
    scratch[i] = depth;
    if (depth > DRY_DEPTH) {
      let ui = uAt(i);
      let wi = wAt(i);
      scratch[n + i] = depth * ui;
      scratch[2u * n + i] = depth * wi;
      speed = sqrt(ui * ui + wi * wi) + sqrt(params.g * depth);
    } else {
      scratch[n + i] = 0.0;
      scratch[2u * n + i] = 0.0;
    }
  }
  wgMax[lid] = speed;
  workgroupBarrier();
  var stride = WORKGROUP / 2u;
  loop {
    if (stride == 0u) { break; }
    if (lid < stride) {
      wgMax[lid] = max(wgMax[lid], wgMax[lid + stride]);
    }
    workgroupBarrier();
    stride = stride / 2u;
  }
  if (lid == 0u) {
    // Wave speeds are non-negative, so their IEEE bit patterns order like the
    // values: an integer max is a float max.
    atomicMax(&maxSpeedBits[0], bitcast<u32>(wgMax[0]));
  }
}

// ── HLL + Audusse reconstruction (scalar, as in swe.cpp) ────────────────────
struct Flux { mass: f32, mom: f32, trans: f32, };
struct FaceState { d: f32, qn: f32, qt: f32, };
struct InterfaceFlux { mass: f32, momL: f32, momR: f32, trans: f32, };

fn normalVelocity(s: FaceState) -> f32 {
  if (s.d > DRY_DEPTH) { return s.qn / s.d; }
  return 0.0;
}

fn physicalFlux(s: FaceState, g: f32) -> Flux {
  let un = normalVelocity(s);
  return Flux(s.qn, s.qn * un + 0.5 * g * s.d * s.d, s.qt * un);
}

fn hllFlux(L: FaceState, R: FaceState, g: f32) -> Flux {
  let dryL = L.d <= DRY_DEPTH;
  let dryR = R.d <= DRY_DEPTH;
  if (dryL && dryR) { return Flux(0.0, 0.0, 0.0); }

  let unL = normalVelocity(L);
  let unR = normalVelocity(R);
  let cL = sqrt(g * max(L.d, 0.0));
  let cR = sqrt(g * max(R.d, 0.0));

  var sL: f32;
  var sR: f32;
  if (dryL) {
    sL = unR - 2.0 * cR;
    sR = unR + cR;
  } else if (dryR) {
    sL = unL - cL;
    sR = unL + 2.0 * cL;
  } else {
    sL = min(unL - cL, unR - cR);
    sR = max(unL + cL, unR + cR);
  }

  let FL = physicalFlux(L, g);
  let FR = physicalFlux(R, g);

  if (sL >= 0.0) { return FL; }
  if (sR <= 0.0) { return FR; }

  let inv = 1.0 / (sR - sL);
  return Flux(
    (sR * FL.mass - sL * FR.mass + sL * sR * (R.d - L.d)) * inv,
    (sR * FL.mom - sL * FR.mom + sL * sR * (R.qn - L.qn)) * inv,
    (sR * FL.trans - sL * FR.trans + sL * sR * (R.qt - L.qt)) * inv,
  );
}

fn reconstructedFlux(dL: f32, qnL: f32, qtL: f32, zbL: f32,
                     dR: f32, qnR: f32, qtR: f32, zbR: f32, g: f32) -> InterfaceFlux {
  let surfaceL = dL + zbL;
  let surfaceR = dR + zbR;
  let zbFace = max(zbL, zbR);

  let dLs = max(0.0, surfaceL - zbFace);
  let dRs = max(0.0, surfaceR - zbFace);

  var unL = 0.0; var utL = 0.0; var unR = 0.0; var utR = 0.0;
  if (dL > DRY_DEPTH) { unL = qnL / dL; utL = qtL / dL; }
  if (dR > DRY_DEPTH) { unR = qnR / dR; utR = qtR / dR; }

  let f = hllFlux(FaceState(dLs, dLs * unL, dLs * utL), FaceState(dRs, dRs * unR, dRs * utR), g);

  return InterfaceFlux(
    f.mass,
    f.mom + 0.5 * g * (dL * dL - dLs * dLs),
    f.mom + 0.5 * g * (dR * dR - dRs * dRs),
    f.trans,
  );
}

// x-face flux between cells iL and iR (normal = x, transverse = z).
fn xFace(iL: u32, iR: u32) -> InterfaceFlux {
  return reconstructedFlux(dAt(iL), qxAt(iL), qzAt(iL), bAt(iL), dAt(iR), qxAt(iR), qzAt(iR), bAt(iR), params.g);
}

// z-face flux between cells iL and iR (normal = z, transverse = x).
fn zFace(iL: u32, iR: u32) -> InterfaceFlux {
  return reconstructedFlux(dAt(iL), qzAt(iL), qxAt(iL), bAt(iL), dAt(iR), qzAt(iR), qxAt(iR), bAt(iR), params.g);
}

// ── update ───────────────────────────────────────────────────────────────────
@compute @workgroup_size(64)
fn update(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.count) { return; }
  let width = params.width;
  let height = params.height;
  let H = params.H;
  let maxWaveSpeed = bitcast<f32>(atomicLoad(&maxSpeedBits[0]));

  // Everything is dry — nothing to advance, but still write back the clamp.
  if (maxWaveSpeed <= 0.0) {
    setH(i, dAt(i) + bAt(i) - H);
    setU(i, 0.0);
    setW(i, 0.0);
    return;
  }

  let safeDt = min(params.dt, CFL_NUMBER * params.dx / maxWaveSpeed);
  let dtdx = safeDt / params.dx;

  let x = i % width;
  let z = i / width;
  let row = z * width;

  // Ghost cells mirror the interior (transmissive boundaries).
  let xLeft = select(x - 1u, 0u, x == 0u);
  let xRight = select(x + 1u, width - 1u, x == width - 1u);
  let zDown = select(z - 1u, 0u, z == 0u);
  let zUp = select(z + 1u, height - 1u, z == height - 1u);

  let fxL = xFace(row + xLeft, i);        // this cell is the right side
  let fxR = xFace(i, row + xRight);       // this cell is the left side
  let fzL = zFace(zDown * width + x, i);
  let fzR = zFace(i, zUp * width + x);

  var accD = 0.0;
  var accQx = 0.0;
  var accQz = 0.0;
  accD = accD + dtdx * fxL.mass;
  accQx = accQx + dtdx * fxL.momR;
  accQz = accQz + dtdx * fxL.trans;
  accD = accD - dtdx * fxR.mass;
  accQx = accQx - dtdx * fxR.momL;
  accQz = accQz - dtdx * fxR.trans;
  accD = accD + dtdx * fzL.mass;
  accQz = accQz + dtdx * fzL.momR;
  accQx = accQx + dtdx * fzL.trans;
  accD = accD - dtdx * fzR.mass;
  accQz = accQz - dtdx * fzR.momL;
  accQx = accQx - dtdx * fzR.trans;

  let depth = max(0.0, dAt(i) + accD);
  if (depth <= DRY_DEPTH) {
    // Dry: pin the surface to the bed so η reports "no water here". The C++
    // damps after this too, but 0 * damp is still 0.
    setH(i, bAt(i) - H);
    setU(i, 0.0);
    setW(i, 0.0);
    return;
  }
  let damp = 1.0 - safeDt * DAMPING_COEFF;
  setH(i, depth + bAt(i) - H);
  setU(i, ((qxAt(i) + accQx) / depth) * damp);
  setW(i, ((qzAt(i) + accQz) / depth) * damp);
}

// ── events (applySWEEvent) ───────────────────────────────────────────────────
@compute @workgroup_size(64)
fn apply_events(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= params.count) { return; }
  let width = params.width;
  let i = idx % width;
  let j = idx / width;
  let dx = params.dx;
  let wz = params.originZ + f32(j) * dx;
  let wx = params.originX + f32(i) * dx;
  var still = 1.2;
  if (params.H > 0.0) { still = params.H; }

  // Each event touches only this cell, so looping events per cell in authored
  // order equals applying them one full-grid pass at a time.
  for (var e = 0u; e < min(params.eventCount, MAX_EVENTS); e = e + 1u) {
    let ev = events.items[e];
    let r = max(0.5, ev.radius);
    let r2 = r * r;
    let mag = max(0.0, ev.strength);
    let stepDt = max(0.0, ev.dt);
    let dz = wz - ev.cz;
    let ddx = wx - ev.cx;
    let d2 = ddx * ddx + dz * dz;
    if (d2 > r2) { continue; }
    let dist = sqrt(d2);
    let wgt = 1.0 - dist / r;
    if (ev.kind == 0) {
      setH(idx, hAt(idx) + mag * stepDt * wgt);
      setW(idx, wAt(idx) - mag * stepDt * wgt * HYDRO_INFLOW_DOWNSTREAM);
    } else if (ev.kind == 1) {
      setH(idx, hAt(idx) - mag * stepDt * wgt * HYDRO_VORTEX_SINK);
      var inv = 0.0;
      if (dist > 1e-4) { inv = 1.0 / dist; }
      setU(idx, uAt(idx) + -dz * inv * mag * stepDt * wgt);
      setW(idx, wAt(idx) + ddx * inv * mag * stepDt * wgt);
    } else if (ev.kind == 2) {
      let shoal = min(mag * wgt, still + 2.0);
      if (shoal > bAt(idx)) { setB(idx, shoal); }
      var side = -1.0;
      if (ddx >= 0.0) { side = 1.0; }
      setU(idx, uAt(idx) + side * mag * stepDt * wgt * HYDRO_BRAID_LATERAL);
    } else if (ev.kind == 3) {
      let damp = max(0.0, 1.0 - mag * stepDt * wgt);
      setU(idx, uAt(idx) * damp);
      setW(idx, wAt(idx) * damp);
    }
  }
}
