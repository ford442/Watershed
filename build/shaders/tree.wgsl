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
    @location(1) normal: vec3<f32>,
    @location(2) worldPos: vec3<f32>,
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
fn vs_main(
    @location(0) pos: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) instancePos: vec3<f32>
) -> VertexOutput {
    var output: VertexOutput;

    // Apply terrain height to instance position
    var iPos = instancePos;
    let h = noise(iPos.xz * 0.05) * 5.0 + noise(iPos.xz * 0.2) * 1.0;
    iPos.y += h;

    // Wind effect for leaves (assume leaves are higher up)
    var p = pos;
    if (pos.y > 2.0) {
        let wind = sin(uniforms.time + iPos.x * 0.5) * 0.1;
        p.x += wind;
    }

    let worldPos = p + iPos;

    output.worldPos = worldPos;
    output.Position = uniforms.projection * uniforms.view * vec4<f32>(worldPos, 1.0);
    output.uv = uv;
    output.normal = normal;
    return output;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>, @location(1) normal: vec3<f32>, @location(2) worldPos: vec3<f32>) -> @location(0) vec4<f32> {
    let color = textureSample(myTexture, mySampler, uv);
    if (color.a < 0.5) {
        discard;
    }

    // Simple lighting
    let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.3));
    let diff = max(dot(normalize(normal), lightDir), 0.2);

    let dist = length(worldPos - uniforms.cameraPos);
    let fogFactor = clamp((dist - 20.0) / 100.0, 0.0, 1.0);
    let fogColor = vec4<f32>(0.6, 0.7, 0.8, 1.0);

    return mix(vec4<f32>(color.rgb * diff, color.a), fogColor, fogFactor);
}
