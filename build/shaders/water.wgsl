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

@vertex
fn vs_main(@location(0) pos: vec3<f32>, @location(2) uv: vec2<f32>) -> VertexOutput {
    var output: VertexOutput;

    // Water level at Y=2.0 approx
    var p = pos;
    let wave = sin(p.x * 0.5 + uniforms.time) * 0.1 + cos(p.z * 0.5 + uniforms.time * 0.8) * 0.1;
    p.y = 1.5 + wave;

    output.worldPos = p;
    output.Position = uniforms.projection * uniforms.view * vec4<f32>(p, 1.0);
    output.uv = uv * 5.0;
    return output;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>, @location(1) worldPos: vec3<f32>) -> @location(0) vec4<f32> {
    let dist = length(worldPos - uniforms.cameraPos);
    let fogFactor = clamp((dist - 20.0) / 100.0, 0.0, 1.0);

    // Sample sky texture (reflection approximation)
    let color = textureSample(myTexture, mySampler, uv + vec2<f32>(uniforms.time * 0.01, 0.0));

    // Water color
    let waterColor = vec4<f32>(0.1, 0.3, 0.5, 0.6);

    let finalColor = mix(waterColor, color, 0.3); // Mix reflection

    let fogColor = vec4<f32>(0.6, 0.7, 0.8, 1.0);

    return mix(finalColor, fogColor, fogFactor);
}
