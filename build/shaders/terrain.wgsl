struct Uniforms {
    view: mat4x4<f32>,
    projection: mat4x4<f32>,
    cameraPos: vec3<f32>,
    time: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var myTexture: texture_2d<f32>;

struct VertexOutput {
    @builtin(position) Position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) worldPos: vec3<f32>,
};

fn hash(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2<f32>(0.0, 0.0)), hash(i + vec2<f32>(1.0, 0.0)), u.x),
               mix(hash(i + vec2<f32>(0.0, 1.0)), hash(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}

@vertex
fn vs_main(@location(0) pos: vec3<f32>, @location(2) uv: vec2<f32>) -> VertexOutput {
    var output: VertexOutput;
    var p = pos;
    // Simple terrain noise
    let h = noise(p.xz * 0.05) * 5.0 + noise(p.xz * 0.2) * 1.0;
    p.y += h;

    output.worldPos = p;
    output.Position = uniforms.projection * uniforms.view * vec4<f32>(p, 1.0);
    output.uv = uv * 10.0; // Tiling
    return output;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>, @location(1) worldPos: vec3<f32>) -> @location(0) vec4<f32> {
    let dist = length(worldPos - uniforms.cameraPos);
    let fogFactor = clamp((dist - 20.0) / 100.0, 0.0, 1.0);

    let texColor = textureSample(myTexture, mySampler, uv);
    let fogColor = vec4<f32>(0.6, 0.7, 0.8, 1.0);

    // Simple shading based on height or normal?
    // We don't have accurate normals for displaced terrain unless we compute derivatives.
    // Let's just use texture.

    return mix(texColor, fogColor, fogFactor);
}
