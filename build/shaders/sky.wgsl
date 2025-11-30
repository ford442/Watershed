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
};

@vertex
fn vs_main(@location(0) pos: vec3<f32>, @location(2) uv: vec2<f32>) -> VertexOutput {
    var output: VertexOutput;
    // Screen space quad (Z = 0.999 to be behind everything)
    output.Position = vec4<f32>(pos.x, pos.z, 0.999, 1.0);
    // In Renderer, createPlane(2,2) gives x,z from -1 to 1.
    // We pass UVs directly.
    output.uv = uv;
    return output;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    // 1. Calculate View Space Ray
    // Projection matrix (perspective):
    // P[0][0] = 1 / (aspect * tan(fov/2))
    // P[1][1] = 1 / tan(fov/2)
    // We want to reconstruct direction (x, y, -1)

    let ndc = uv * 2.0 - 1.0;
    // Invert Y because UV 0,0 is usually top-left, but NDC Y is up.
    // Renderer createPlane UV: (0,0) at (-1, -1)? No.
    // Let's assume standard UV (0,0 top-left). NDC Y is bottom (-1) to top (1).
    // So ndc.y = (1.0 - uv.y) * 2.0 - 1.0 = 1.0 - 2.0*uv.y
    // Let's stick to simplest:
    let x = ndc.x / uniforms.projection[0][0];
    let y = -ndc.y / uniforms.projection[1][1]; // Invert Y for correct look
    let viewDir = normalize(vec3<f32>(x, y, -1.0));

    // 2. Transform to World Space (Inverse View Rotation)
    // View Matrix transforms World -> View.
    // We extract the rotation part (upper 3x3) and Transpose it (which is Inverse for rotation).
    let rot = mat3x3<f32>(
        uniforms.view[0].xyz,
        uniforms.view[1].xyz,
        uniforms.view[2].xyz
    );
    // Note: GL-Matrix lookAt produces View Matrix.
    // Transpose of Rotation is Inverse.
    // But WGSL matrices are column-major.
    // let invRot = transpose(rot);
    // We want worldDir = invRot * viewDir;
    // In WGSL: vector * matrix is row-vector mult (v^T * M).
    // matrix * vector is column-vector mult (M * v).
    // We want M * v.

    // Actually, View Matrix R is:
    // [Rx, Ry, Rz]
    // [Ux, Uy, Uz]
    // [Fx, Fy, Fz]
    // So rows are axes.
    // Transpose makes columns axes.

    let worldDir = normalize(viewDir * rot); // v * M is equivalent to M^T * v. Since rot is View (World->View), we want View->World (Inverse).
    // Since 'rot' is orthogonal, Inverse = Transpose.
    // v * rot = (rot^T * v^T)^T ... wait.
    // viewDir * rot applies the transpose of rot to viewDir.
    // So this IS the inverse rotation!

    // 3. Sample Equirectangular Map
    let pi = 3.14159265;
    let atan_x = atan2(worldDir.z, worldDir.x); // -PI to PI
    let u = atan_x / (2.0 * pi) + 0.5;
    let v = asin(clamp(worldDir.y, -1.0, 1.0)) / pi + 0.5;

    return textureSample(myTexture, mySampler, vec2<f32>(u, v));
}
