import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Sky } from '@react-three/drei';
import * as THREE from 'three';
import { useBiome } from '../systems/BiomeSystem';
import { useSunPosition } from '../systems/SunPositionSystem';
import { BiomePalettes } from '../configs/BiomePalettes';
import { useGameStore } from '../systems/GameState';

const SKY_OVERRIDES = {
    alpineSpring: {
        sunPosition: [90, 42, 65],
        turbidity: 5.8,
        rayleigh: 3.7,
        mieCoefficient: 0.0035,
        mieDirectionalG: 0.8,
    },
    canyonSummer: {
        sunPosition: [100, 34, 90],
        turbidity: 6.4,
        rayleigh: 3.8,
        mieCoefficient: 0.004,
        mieDirectionalG: 0.82,
    },
    canyonAutumn: {
        sunPosition: [95, 24, 55],
        turbidity: 9.5,
        rayleigh: 2.5,
        mieCoefficient: 0.007,
        mieDirectionalG: 0.86,
    },
    cavern: {
        sunPosition: [0, 8, 12],
        turbidity: 12.0,
        rayleigh: 0.8,
        mieCoefficient: 0.012,
        mieDirectionalG: 0.9,
    },
    delta: {
        sunPosition: [80, 22, 80],
        turbidity: 7.2,
        rayleigh: 3.3,
        mieCoefficient: 0.005,
        mieDirectionalG: 0.83,
    },
    midnightMist: {
        sunPosition: [20, 14, 30],
        turbidity: 11.0,
        rayleigh: 1.2,
        mieCoefficient: 0.01,
        mieDirectionalG: 0.88,
    },
    pond: {
        sunPosition: [80, 18, 80],
        turbidity: 6.8,
        rayleigh: 3.1,
        mieCoefficient: 0.0048,
        mieDirectionalG: 0.82,
    },
    slotCanyon: {
        sunPosition: [100, 60, 20],
        turbidity: 10.8,
        rayleigh: 2.0,
        mieCoefficient: 0.009,
        mieDirectionalG: 0.88,
    },
};

// Two cloud layers at different "altitudes" (Y position) get slightly different
// scroll speeds, scales and shading response so they read as separate strata
// rather than a single flat ribbon.
const CLOUD_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CLOUD_FRAGMENT = `
  uniform float time;
  uniform float opacity;
  uniform float sunsetBlend;
  uniform float overcastBlend;
  uniform vec3 cloudColorA;
  uniform vec3 cloudColorB;
  uniform vec3 sunDir2D;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv * 2.8;
    uv.x += time * 0.003;
    uv.y += time * 0.0018;

    float n = fbm(uv);
    float cloud = smoothstep(0.52, 0.8, n);

    // Cheap directional self-shadowing: sample the density a short hop toward
    // the sun. Where that sample is denser than here, this texel sits in the
    // shadow of the cloud mass facing the sun and reads darker.
    float nSun = fbm(uv + sunDir2D.xz * 0.18);
    float cloudSun = smoothstep(0.52, 0.8, nSun);
    float litFactor = clamp(0.5 + (cloud - cloudSun) * 1.6, 0.0, 1.0);

    vec3 cloudColor = mix(cloudColorA, cloudColorB, sunsetBlend);
    vec3 shadowColor = cloudColor * 0.55;
    vec3 highlightColor = mix(cloudColor, vec3(1.0, 0.98, 0.92), 0.55);
    vec3 litColor = mix(shadowColor, highlightColor, litFactor);

    // Overcast weather flattens and darkens the cloud deck toward a uniform grey.
    litColor = mix(litColor, vec3(0.55, 0.57, 0.6), overcastBlend * 0.85);
    float cloudCoverage = mix(cloud, clamp(cloud + 0.35, 0.0, 1.0), overcastBlend);

    float alpha = cloudCoverage * opacity;
    gl_FragColor = vec4(litColor, alpha);
  }
`;

// --- Star field -----------------------------------------------------------
// Custom point-sprite star field: per-star magnitude, color tint and twinkle
// phase, plus an optional "band" mode that biases stars toward a great-circle
// to fake a Milky Way streak for the midnight-mist biome.
const STAR_VERTEX = `
  attribute float aSize;
  attribute float aPhase;
  attribute float aSpeed;
  uniform float uTime;
  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    vColor = color;
    float twinkle = 0.55 + 0.45 * sin(uTime * aSpeed + aPhase);
    vTwinkle = twinkle;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * twinkle * (300.0 / -mvPosition.z);
  }
`;

const STAR_FRAGMENT = `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float core = smoothstep(0.5, 0.0, d);
    if (core <= 0.001) discard;
    gl_FragColor = vec4(vColor, core * vTwinkle * uOpacity);
  }
`;

// Builds a star field as a flat attribute set for THREE.BufferGeometry.
const buildStarField = (count, { radiusMin, radiusMax, band = false, seedOffset = 0 }) => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const tmpColor = new THREE.Color();

    const hash = (n) => {
        const x = Math.sin(n * 17.31 + seedOffset) * 43758.5453;
        return x - Math.floor(x);
    };

    for (let i = 0; i < count; i++) {
        const a = hash(i * 1.7);
        const b = hash(i * 2.9 + 4.1);
        const c = hash(i * 3.3 + 8.2);

        let theta = a * Math.PI * 2;
        let phi;
        if (band) {
            // Cluster near a tilted great-circle band to suggest the galactic plane.
            phi = Math.PI * 0.5 + (b - 0.5) * 0.55;
        } else {
            phi = Math.acos(THREE.MathUtils.clamp(1 - 2 * b, -1, 1));
        }

        const r = radiusMin + c * (radiusMax - radiusMin);
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = Math.abs(r * Math.cos(phi)) * 0.7 + r * 0.15; // bias toward upper hemisphere
        const z = r * Math.sin(phi) * Math.sin(theta);

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        const mag = hash(i * 5.7 + 2.3);
        const size = band ? 1.0 + mag * 1.4 : 0.8 + mag * 2.6;
        sizes[i] = size;

        if (mag > 0.88) {
            tmpColor.set('#bcd4ff'); // hot blue-white
        } else if (mag > 0.6) {
            tmpColor.set('#ffffff');
        } else {
            tmpColor.set('#ffe9c8'); // warm faint stars
        }
        if (band) tmpColor.multiplyScalar(0.85);
        colors[i * 3] = tmpColor.r;
        colors[i * 3 + 1] = tmpColor.g;
        colors[i * 3 + 2] = tmpColor.b;

        phases[i] = hash(i * 9.1 + 1.0) * Math.PI * 2;
        speeds[i] = 0.6 + hash(i * 11.3 + 6.6) * 2.4;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    return geo;
};

// --- Moon -------------------------------------------------------------------
// A simple low-poly moon with a soft crater normal-bump and a phase
// terminator (a darkened crescent edge) baked in via onBeforeCompile.
const MOON_PHASE = 0.32; // 0 = new, 0.5 = full, 1 = new again (waxing gibbous)

const buildMoonGeometry = () => {
    const geo = new THREE.IcosahedronGeometry(1, 4);
    const positions = geo.attributes.position;
    const hash = (n) => {
        const x = Math.sin(n * 91.7) * 43758.5453;
        return x - Math.floor(x);
    };
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        const n = hash(x * 12.9 + y * 78.2 + z * 37.7);
        const bump = 1.0 - n * 0.04; // shallow craters
        positions.setXYZ(i, x * bump, y * bump, z * bump);
    }
    geo.computeVertexNormals();
    return geo;
};

const getSkyProfile = (biomeId, isSlotCanyon) => {
    if (isSlotCanyon && SKY_OVERRIDES.slotCanyon) {
        return SKY_OVERRIDES.slotCanyon;
    }
    return SKY_OVERRIDES[biomeId] || SKY_OVERRIDES.canyonSummer;
};

export default function EnhancedSky() {
    const { scene } = useThree();
    const { currentBiome, timeOfDay, transitionProgress } = useBiome();
    const { setSunWorldPosition } = useSunPosition();
    const currentSegmentIndex = useGameStore((s) => s.currentSegmentIndex);
    const isSlotCanyon = currentSegmentIndex >= 20 && currentSegmentIndex <= 22;
    const [weatherType, setWeatherType] = useState('clear');

    const fogObjRef = useRef();
    const cloudMatNearRef = useRef();
    const cloudMatFarRef = useRef();
    const starsMatRef = useRef();
    const milkyMatRef = useRef();
    const moonGroupRef = useRef();
    const moonLightRef = useRef();
    const sunGlowRef = useRef();
    const sunWorldPosRef = useRef(new THREE.Vector3());
    const moonWorldPosRef = useRef(new THREE.Vector3());
    const fogStateRef = useRef({
        color: new THREE.Color(BiomePalettes.canyonSummer.fogColor),
        near: 65,
        far: 220,
    });

    const skyProfile = useMemo(
        () => getSkyProfile(currentBiome.id, isSlotCanyon),
        [currentBiome.id, isSlotCanyon]
    );

    const cloudOpacity = isSlotCanyon ? 0.3 : currentBiome.id === 'delta' ? 0.5 : 0.42;
    const sunsetBlend = THREE.MathUtils.smoothstep(timeOfDay, 0.65, 0.9);

    // 0 at noon, 1 at midnight - drives star/moon visibility and moonlight strength.
    const dayPhase = Math.abs(timeOfDay - 0.5) * 2;
    const nightFactor = THREE.MathUtils.smoothstep(dayPhase, 0.6, 0.85);

    const skySunPosition = useMemo(() => {
        const dayArc = (timeOfDay - 0.5) * Math.PI;
        const base = skyProfile.sunPosition;
        const x = base[0] + Math.sin(dayArc) * (isSlotCanyon ? 8 : 24);
        const y = Math.max(8, base[1] + Math.cos(dayArc * 0.85) * 18);
        const z = base[2] + Math.cos(dayArc) * (isSlotCanyon ? 6 : 14);
        return [x, y, z];
    }, [isSlotCanyon, skyProfile.sunPosition, timeOfDay]);

    // Moon rides the opposite side of the sky from the sun, on the same arc.
    const moonWorldPosition = useMemo(() => {
        const dayArc = (timeOfDay - 0.5) * Math.PI + Math.PI;
        const x = Math.sin(dayArc) * 130;
        const y = Math.max(15, Math.cos(dayArc * 0.85) * 70 + 30);
        const z = Math.cos(dayArc) * 110;
        return [x, y, z];
    }, [timeOfDay]);

    const sunGlowTexture = useMemo(() => {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        gradient.addColorStop(0, 'rgba(255,255,255,1.0)');
        gradient.addColorStop(0.18, 'rgba(255,250,235,0.85)');
        gradient.addColorStop(0.5, 'rgba(255,220,170,0.22)');
        gradient.addColorStop(1, 'rgba(255,200,150,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
        const tex = new THREE.CanvasTexture(canvas);
        return tex;
    }, []);

    const starGeometry = useMemo(
        () => buildStarField(1100, { radiusMin: 150, radiusMax: 280, seedOffset: 0 }),
        []
    );
    const milkyWayGeometry = useMemo(
        () => buildStarField(900, { radiusMin: 160, radiusMax: 260, band: true, seedOffset: 31.7 }),
        []
    );
    const moonGeometry = useMemo(() => buildMoonGeometry(), []);

    const moonMaterial = useMemo(() => {
        const mat = new THREE.MeshStandardMaterial({
            color: '#cfd6e2',
            emissive: '#3a4252',
            emissiveIntensity: 0.4,
            roughness: 0.95,
            metalness: 0.0,
            transparent: true,
            opacity: 0,
        });

        mat.onBeforeCompile = (shader) => {
            shader.uniforms.uPhase = { value: MOON_PHASE };
            shader.fragmentShader = `uniform float uPhase;\n` + shader.fragmentShader.replace(
                '#include <dithering_fragment>',
                `
// Phase terminator: darken the portion of the disc facing away from the
// illuminated limb based on view-space normal X component.
float terminator = smoothstep(-0.15, 0.15, normalize(vNormal).x - (uPhase - 0.5) * 2.0);
gl_FragColor.rgb *= mix(0.18, 1.0, terminator);
#include <dithering_fragment>
`
            );
            mat.userData.shader = shader;
        };
        mat.needsUpdate = true;
        return mat;
    }, []);

    useEffect(() => {
        const onWeatherUpdate = (event) => {
            const incoming = event?.detail?.type;
            if (typeof incoming === 'string') setWeatherType(incoming);
        };
        window.addEventListener('weather-update', onWeatherUpdate);
        return () => window.removeEventListener('weather-update', onWeatherUpdate);
    }, []);

    useEffect(() => {
        scene.userData.skyOwnsFog = true;
        return () => {
            scene.userData.skyOwnsFog = false;
        };
    }, [scene]);

    const overcastBlend = (weatherType === 'overcast' || weatherType === 'storm') ? 1 : weatherType === 'fog' ? 0.5 : 0;

    useFrame((state, delta) => {
        const step = Math.min(1.0, delta * (0.9 + transitionProgress * 0.2));

        const targetFogColor = new THREE.Color(currentBiome.fogColor);
        const slotFogNear = 40;
        const slotFogFar = 145;
        const pondFogNear = 85;
        const pondFogFar = 260;
        const targetFogNear = isSlotCanyon
            ? slotFogNear
            : (currentBiome.id === 'delta' ? pondFogNear : currentBiome.fogNear);
        const targetFogFar = isSlotCanyon
            ? slotFogFar
            : (currentBiome.id === 'delta' ? pondFogFar : currentBiome.fogFar);

        fogStateRef.current.color.lerp(targetFogColor, step);
        fogStateRef.current.near += (targetFogNear - fogStateRef.current.near) * step;
        fogStateRef.current.far += (targetFogFar - fogStateRef.current.far) * step;

        if (fogObjRef.current) {
            fogObjRef.current.color.copy(fogStateRef.current.color);
            fogObjRef.current.near = fogStateRef.current.near;
            fogObjRef.current.far = fogStateRef.current.far;
        }

        if (state.scene.background instanceof THREE.Color) {
            state.scene.background.copy(fogStateRef.current.color);
        }

        state.scene.userData.skyOwnsFog = true;

        sunWorldPosRef.current.set(skySunPosition[0], skySunPosition[1], skySunPosition[2]);
        setSunWorldPosition(sunWorldPosRef.current);
        moonWorldPosRef.current.set(moonWorldPosition[0], moonWorldPosition[1], moonWorldPosition[2]);

        const sunDirNorm = sunWorldPosRef.current.clone().normalize();

        if (cloudMatNearRef.current?.uniforms) {
            cloudMatNearRef.current.uniforms.time.value = state.clock.elapsedTime;
            cloudMatNearRef.current.uniforms.opacity.value = cloudOpacity;
            cloudMatNearRef.current.uniforms.sunsetBlend.value = sunsetBlend;
            cloudMatNearRef.current.uniforms.overcastBlend.value = overcastBlend;
            cloudMatNearRef.current.uniforms.sunDir2D.value.copy(sunDirNorm);
        }
        if (cloudMatFarRef.current?.uniforms) {
            cloudMatFarRef.current.uniforms.time.value = state.clock.elapsedTime + 23.0;
            cloudMatFarRef.current.uniforms.opacity.value = cloudOpacity * 0.8;
            cloudMatFarRef.current.uniforms.sunsetBlend.value = sunsetBlend;
            cloudMatFarRef.current.uniforms.overcastBlend.value = overcastBlend;
            cloudMatFarRef.current.uniforms.sunDir2D.value.copy(sunDirNorm);
        }

        const starsBlockedByWeather = weatherType === 'overcast' || weatherType === 'fog' || weatherType === 'storm';
        const starAlpha = starsBlockedByWeather ? 0 : nightFactor;

        if (starsMatRef.current?.uniforms) {
            starsMatRef.current.uniforms.uTime.value = state.clock.elapsedTime;
            starsMatRef.current.uniforms.uOpacity.value = starAlpha;
        }
        if (milkyMatRef.current?.uniforms) {
            milkyMatRef.current.uniforms.uTime.value = state.clock.elapsedTime;
            const milkyBoost = currentBiome.id === 'midnightMist' ? 1.0 : 0.35;
            milkyMatRef.current.uniforms.uOpacity.value = starAlpha * milkyBoost;
        }

        // Moon: fades in at night, sits opposite the sun.
        if (moonGroupRef.current) {
            moonGroupRef.current.position.copy(moonWorldPosRef.current);
            const dist = moonGroupRef.current.position.length();
            const moonScale = Math.max(6, dist * 0.045);
            moonGroupRef.current.scale.setScalar(moonScale);
            moonGroupRef.current.lookAt(0, 0, 0);
        }
        moonMaterial.opacity = THREE.MathUtils.lerp(moonMaterial.opacity, nightFactor, 0.05);
        if (moonLightRef.current) {
            moonLightRef.current.position.copy(moonWorldPosRef.current);
            moonLightRef.current.intensity = THREE.MathUtils.lerp(
                moonLightRef.current.intensity,
                0.18 * nightFactor * (1 - overcastBlend * 0.7),
                0.05
            );
        }

        // Sun glow sprite: brighter and warmer near the horizon (golden hour),
        // fades out entirely at night or under heavy overcast.
        if (sunGlowRef.current) {
            sunGlowRef.current.position.set(skySunPosition[0], skySunPosition[1], skySunPosition[2]);
            const elevation = THREE.MathUtils.clamp(skySunPosition[1] / 60, 0, 1);
            const glowScale = 28 + (1 - elevation) * 26;
            sunGlowRef.current.scale.setScalar(glowScale);
            const mat = sunGlowRef.current.material;
            mat.opacity = (1 - nightFactor) * (1 - overcastBlend * 0.8);
            mat.color.set(sunsetBlend > 0.01 ? '#ffb066' : '#fff7e0').lerp(new THREE.Color('#fff7e0'), 1 - sunsetBlend);
        }
    });

    const dimFactor = isSlotCanyon ? 0.7 : 1.0;

    return (
        <group>
            <Sky
                distance={450000}
                sunPosition={skySunPosition}
                turbidity={skyProfile.turbidity}
                rayleigh={skyProfile.rayleigh}
                mieCoefficient={skyProfile.mieCoefficient}
                mieDirectionalG={skyProfile.mieDirectionalG}
            />

            {/* Sun glow / lens-flare-ish billboard */}
            <sprite ref={sunGlowRef} position={skySunPosition} scale={[40, 40, 1]}>
                <spriteMaterial
                    map={sunGlowTexture}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                    opacity={0}
                />
            </sprite>

            {/* Twinkling star field */}
            <points geometry={starGeometry} frustumCulled={false}>
                <shaderMaterial
                    ref={starsMatRef}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                    vertexColors
                    uniforms={{
                        uTime: { value: 0 },
                        uOpacity: { value: 0 },
                    }}
                    vertexShader={STAR_VERTEX}
                    fragmentShader={STAR_FRAGMENT}
                />
            </points>

            {/* Faint Milky Way band, prominent in the midnight-mist biome */}
            <points geometry={milkyWayGeometry} frustumCulled={false}>
                <shaderMaterial
                    ref={milkyMatRef}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                    vertexColors
                    uniforms={{
                        uTime: { value: 0 },
                        uOpacity: { value: 0 },
                    }}
                    vertexShader={STAR_VERTEX}
                    fragmentShader={STAR_FRAGMENT}
                />
            </points>

            {/* Moon: low-poly sphere with a baked phase terminator + soft moonlight */}
            <group ref={moonGroupRef}>
                <mesh geometry={moonGeometry} material={moonMaterial} />
            </group>
            <pointLight
                ref={moonLightRef}
                color="#9db4ff"
                intensity={0}
                distance={0}
                decay={0}
            />

            {/* Procedural cloud ribbon: two cheap layers, no external assets,
                shaded toward the sun direction and flattened by overcast weather. */}
            <mesh position={[0, 40, 0]} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false}>
                <planeGeometry args={[700, 700, 1, 1]} />
                <shaderMaterial
                    ref={cloudMatNearRef}
                    transparent
                    depthWrite={false}
                    side={THREE.DoubleSide}
                    blending={THREE.NormalBlending}
                    uniforms={{
                        time: { value: 0 },
                        opacity: { value: cloudOpacity },
                        sunsetBlend: { value: sunsetBlend },
                        overcastBlend: { value: overcastBlend },
                        cloudColorA: { value: new THREE.Color('#fff2e2').multiplyScalar(dimFactor) },
                        cloudColorB: { value: new THREE.Color('#ffcc88').multiplyScalar(dimFactor) },
                        sunDir2D: { value: new THREE.Vector3(0.3, 0, 0.3) },
                    }}
                    vertexShader={CLOUD_VERTEX}
                    fragmentShader={CLOUD_FRAGMENT}
                />
            </mesh>

            <mesh position={[0, 55, 0]} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false}>
                <planeGeometry args={[820, 820, 1, 1]} />
                <shaderMaterial
                    ref={cloudMatFarRef}
                    transparent
                    depthWrite={false}
                    side={THREE.DoubleSide}
                    blending={THREE.NormalBlending}
                    uniforms={{
                        time: { value: 23 },
                        opacity: { value: cloudOpacity * 0.8 },
                        sunsetBlend: { value: sunsetBlend },
                        overcastBlend: { value: overcastBlend },
                        cloudColorA: { value: new THREE.Color('#f8eee0').multiplyScalar(dimFactor) },
                        cloudColorB: { value: new THREE.Color('#f0b773').multiplyScalar(dimFactor) },
                        sunDir2D: { value: new THREE.Vector3(0.3, 0, 0.3) },
                    }}
                    vertexShader={CLOUD_VERTEX}
                    fragmentShader={CLOUD_FRAGMENT}
                />
            </mesh>

            {/* Linear haze for stronger depth layering; tightened in slot canyons. */}
            <fog ref={fogObjRef} attach="fog" args={[currentBiome.fogColor, currentBiome.fogNear, currentBiome.fogFar]} />
        </group>
    );
}
