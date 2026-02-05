/**
 * Extends a MeshStandardMaterial with procedural river environment effects:
 * - Wetness: Darkens and smooths surfaces near the water level (Y=0.5).
 * - Moss: Adds a fuzzy green layer on upward-facing slopes near the water.
 * - Caustics: Projects animated water ripples on surfaces below the water.
 *
 * @param {THREE.MeshStandardMaterial} material - The material to extend.
 */
export function extendRiverMaterial(material) {
    material.onBeforeCompile = (shader) => {
        material.userData.shader = shader; // Save for uniform updates
        shader.uniforms.time = { value: 0 };

        // --- Vertex Shader ---
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `
            #include <common>
            varying vec3 vNormRiver;
            varying vec3 vPosRiver;
            `
        );

        // Calculate World Position and Normal
        // Compatible with InstancedMesh (where modelMatrix * transformed includes instance transform)
        shader.vertexShader = shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            `
            #include <worldpos_vertex>
            vPosRiver = (modelMatrix * vec4(transformed, 1.0)).xyz;
            vNormRiver = normalize(mat3(modelMatrix) * objectNormal);
            `
        );

        // --- Fragment Shader ---
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `
            #include <common>
            uniform float time;
            varying vec3 vNormRiver;
            varying vec3 vPosRiver;

            // Simple noise function
            float hashRiver(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
            float noiseRiver(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f*f*(3.0-2.0*f);
                return mix(mix(hashRiver(i + vec2(0.0,0.0)), hashRiver(i + vec2(1.0,0.0)), f.x),
                           mix(hashRiver(i + vec2(0.0,1.0)), hashRiver(i + vec2(1.0,1.0)), f.x), f.y);
            }

            // Stylized Caustics
            float causticRiver(vec2 uv, float time) {
                vec2 p = uv * 3.0;
                float t = time * 0.8;
                float val = 0.0;
                val += sin(p.x + t + p.y * 0.5);
                val += sin(p.y - t * 0.5 + p.x * 0.5);
                val += sin(p.x + p.y + t * 0.2);
                return pow(0.5 + 0.5 * val / 1.5, 4.0);
            }
            `
        );

        // Inject Color Logic (Wetness + Moss + Caustics)
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `
            #include <map_fragment>

            // --- CONSTANTS ---
            vec3 mossColor = vec3(0.18, 0.35, 0.12); // "National Park" Moss Green
            float waterLevel = 0.5;

            // --- MOSS LOGIC ---
            float mossNoise = noiseRiver(vPosRiver.xz * 0.5) * 0.2;

            // Moss grows on upward facing slopes (y > threshold)
            float mossSlope = smoothstep(0.5, 0.8, vNormRiver.y + mossNoise);

            // Moss grows near water line (Y ~= 0.5) up to Y=2.5
            float waterDist = vPosRiver.y - waterLevel;
            float mossWater = smoothstep(2.5, 0.0, waterDist) * 0.6;

            float finalMoss = clamp(mossSlope + mossWater, 0.0, 1.0);

            // --- WET BAND LOGIC ---
            // Darken near water line (0.5 to 1.5)
            float wetness = 1.0 - smoothstep(0.0, 1.0, waterDist);
            wetness = clamp(wetness, 0.0, 1.0);

            // Apply Wetness (Darken)
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.5, wetness);

            // Apply Moss (Mix Color)
            diffuseColor.rgb = mix(diffuseColor.rgb, mossColor, finalMoss * 0.9);

            // --- CAUSTICS LOGIC ---
            // Only below water
            if (waterDist < 0.1) {
                float causticMask = 1.0 - smoothstep(-0.5, 0.0, waterDist);
                float cPattern = causticRiver(vPosRiver.xz, time);
                vec3 causticColor = vec3(1.0, 1.0, 0.9);
                diffuseColor.rgb += causticColor * cPattern * causticMask * 0.4;
            }
            `
        );

        // Inject Roughness Logic
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <roughnessmap_fragment>',
            `
            #include <roughnessmap_fragment>

            // Re-calculate basic vars for roughness (local scope)
            float r_waterLevel = 0.5;
            float r_waterDist = vPosRiver.y - r_waterLevel;

            // Wetness Roughness
            float r_wetness = 1.0 - smoothstep(0.0, 1.0, r_waterDist);
            r_wetness = clamp(r_wetness, 0.0, 1.0);

            if (r_wetness > 0.0) {
                 roughnessFactor = mix(roughnessFactor, 0.1, r_wetness);
            }

            // Moss Roughness
            float r_mossNoise = noiseRiver(vPosRiver.xz * 0.5) * 0.2;
            float r_mossSlope = smoothstep(0.5, 0.8, vNormRiver.y + r_mossNoise);
            float r_mossWater = smoothstep(2.5, 0.0, r_waterDist) * 0.6;
            float r_finalMoss = clamp(r_mossSlope + r_mossWater, 0.0, 1.0);

            if (r_finalMoss > 0.5) {
                roughnessFactor = mix(roughnessFactor, 1.0, (r_finalMoss - 0.5) * 2.0);
            }
            `
        );
    };
}
