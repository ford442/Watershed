import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Sky } from '@react-three/drei';
import * as THREE from 'three';
import { useBiomeId, useBiomeStore } from '../systems/biome/BiomeSystem';
import { SUN_DISTANCE, useSunPosition } from '../systems/lighting/SunPositionSystem';
import { getSkyClock } from '../systems/sky/skyClock';
import { BiomePalettes } from '../configs/BiomePalettes';
import { useGameStore } from '../systems/GameState';
import type { BiomeId } from '../configs/biomes';
import { resolveMaterialBackend } from '../rendering/materialBackend';
import {
  createCloudMaterial,
  createMoonMaterial,
  createSkyDomeMaterial,
  createStarMaterial,
} from '../materials/sky/createSkyMaterials';
import { materialUniformBag } from '../materials/dual/materialUniformBag';
import { sinHash } from '../math/hash';

interface SkyProfile {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
}

const SKY_OVERRIDES: Partial<Record<BiomeId | 'pond' | 'slotCanyon', SkyProfile>> = {
    alpineSpring: {
        turbidity: 5.8,
        rayleigh: 3.7,
        mieCoefficient: 0.0035,
        mieDirectionalG: 0.8,
    },
    canyonSummer: {
        turbidity: 6.4,
        rayleigh: 3.8,
        mieCoefficient: 0.004,
        mieDirectionalG: 0.82,
    },
    canyonAutumn: {
        turbidity: 9.5,
        rayleigh: 2.5,
        mieCoefficient: 0.007,
        mieDirectionalG: 0.86,
    },
    cavern: {
        turbidity: 12.0,
        rayleigh: 0.8,
        mieCoefficient: 0.012,
        mieDirectionalG: 0.9,
    },
    delta: {
        turbidity: 7.2,
        rayleigh: 3.3,
        mieCoefficient: 0.005,
        mieDirectionalG: 0.83,
    },
    midnightMist: {
        turbidity: 11.0,
        rayleigh: 1.2,
        mieCoefficient: 0.01,
        mieDirectionalG: 0.88,
    },
    pond: {
        turbidity: 6.8,
        rayleigh: 3.1,
        mieCoefficient: 0.0048,
        mieDirectionalG: 0.82,
    },
    slotCanyon: {
        turbidity: 10.8,
        rayleigh: 2.0,
        mieCoefficient: 0.009,
        mieDirectionalG: 0.88,
    },
    glacialMelt: {
        turbidity: 4.2,
        rayleigh: 4.8,
        mieCoefficient: 0.0025,
        mieDirectionalG: 0.76,
    },
    glacier: {
        turbidity: 4.5,
        rayleigh: 4.6,
        mieCoefficient: 0.0028,
        mieDirectionalG: 0.78,
    },
};

interface StarFieldOptions {
  radiusMin: number;
  radiusMax: number;
  band?: boolean;
  seedOffset?: number;
}

// Builds a star field as a flat attribute set for THREE.BufferGeometry.
const buildStarField = (count: number, { radiusMin, radiusMax, band = false, seedOffset = 0 }: StarFieldOptions) => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const tmpColor = new THREE.Color();

    const hash = (n: number) => sinHash(n * 17.31 + seedOffset);

    for (let i = 0; i < count; i++) {
        const a = hash(i * 1.7);
        const b = hash(i * 2.9 + 4.1);
        const c = hash(i * 3.3 + 8.2);

        const theta = a * Math.PI * 2;
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
    const hash = (n: number) => sinHash(n * 91.7);
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

const getSkyProfile = (biomeId: string, isSlotCanyon: boolean): SkyProfile => {
    if (isSlotCanyon && SKY_OVERRIDES.slotCanyon) {
        return SKY_OVERRIDES.slotCanyon;
    }
    return SKY_OVERRIDES[biomeId as keyof typeof SKY_OVERRIDES] || SKY_OVERRIDES.canyonSummer!;
};

// Sky-at-infinity distances from the camera (the old fixed sun / moon points sat this far from the origin).
const MOON_DISTANCE = 185;
const NIGHT_FOG = new THREE.Color('#1a2a4a');
const GOLDEN_FOG = new THREE.Color('#f0b07a');
const DAWN_FOG = new THREE.Color('#8fa7c8');
const SUN_GLOW_DAY = new THREE.Color('#fff7e0');
const SUN_GLOW_LOW = new THREE.Color('#ffb066');
// Frame scratch.
const _targetFog = new THREE.Color();
const _moonDir = new THREE.Vector3();

export default function EnhancedSky() {
    const { scene } = useThree();
    // The palette id re-renders (sky profile, clouds); the cross-fading colours
    // are read per frame from the store, never as React state.
    const biomeStore = useBiomeStore();
    const biomeId = useBiomeId();
    // The fog's constructor args, once: every frame after writes it from fogStateRef.
    const [initialFog] = useState(() => {
        const { fogColor, fogNear, fogFar } = biomeStore.getState().currentBiome;
        return [fogColor, fogNear, fogFar] as [string, number, number];
    });
    const { sunDirection } = useSunPosition();
    const currentSegmentIndex = useGameStore((s) => s.currentSegmentIndex);
    const isSlotCanyon = currentSegmentIndex >= 20 && currentSegmentIndex <= 22;
    const weatherType = useGameStore((s) => s.weather.type);
    const materialBackend = useMemo(() => resolveMaterialBackend().backend, []);

    const fogObjRef = useRef<THREE.Fog | null>(null);
    const cloudMatNearRef = useRef<THREE.Material | null>(null);
    const cloudMatFarRef = useRef<THREE.Material | null>(null);
    const starsMatRef = useRef<THREE.Material | null>(null);
    const milkyMatRef = useRef<THREE.Material | null>(null);
    const skyDomeMatRef = useRef<THREE.Material | null>(null);
    const skyRef = useRef<React.ComponentRef<typeof Sky> | null>(null);
    /** Sun glow, stars, moon: things at infinity, carried with the camera. */
    const celestialRef = useRef<THREE.Group | null>(null);
    const moonGroupRef = useRef<THREE.Group | null>(null);
    const moonLightRef = useRef<THREE.PointLight | null>(null);
    const sunGlowRef = useRef<THREE.Sprite | null>(null);
    const fogStateRef = useRef({
        color: new THREE.Color(BiomePalettes.canyonSummer.fogColor),
        near: 65,
        far: 220,
    });

    const skyProfile = useMemo(
        () => getSkyProfile(biomeId, isSlotCanyon),
        [biomeId, isSlotCanyon]
    );

    const cloudOpacity = isSlotCanyon ? 0.3 : biomeId === 'delta' ? 0.5 : 0.42;
    // The sun at mount (the drei Sky's first uniform); every frame after comes from the sky clock.
    const initialSunPosition = useMemo((): [number, number, number] => {
        const { sun } = getSkyClock();
        return [sun.x * SUN_DISTANCE, sun.y * SUN_DISTANCE, sun.z * SUN_DISTANCE];
    }, []);

    const sunGlowTexture = useMemo(() => {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return new THREE.Texture();
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

    const moonMaterial = useMemo(
        () => createMoonMaterial(materialBackend, MOON_PHASE),
        [materialBackend],
    );

    const cloudMatNear = useMemo(() => {
        const mat = createCloudMaterial(materialBackend, {
            opacity: 0.42,
            sunsetBlend: 0,
            overcastBlend: 0,
            cloudColorA: new THREE.Color('#fff2e2'),
            cloudColorB: new THREE.Color('#ffcc88'),
            sunDir2D: new THREE.Vector3(0.3, 0, 0.3),
        });
        cloudMatNearRef.current = mat;
        return mat;
    }, [materialBackend]);

    const cloudMatFar = useMemo(() => {
        const mat = createCloudMaterial(materialBackend, {
            time: 23,
            opacity: 0.34,
            sunsetBlend: 0,
            overcastBlend: 0,
            cloudColorA: new THREE.Color('#f8eee0'),
            cloudColorB: new THREE.Color('#f0b773'),
            sunDir2D: new THREE.Vector3(0.3, 0, 0.3),
        });
        cloudMatFarRef.current = mat;
        return mat;
    }, [materialBackend]);

    const starsMat = useMemo(() => {
        const mat = createStarMaterial(materialBackend, { uOpacity: 0 });
        starsMatRef.current = mat;
        return mat;
    }, [materialBackend]);

    const milkyMat = useMemo(() => {
        const mat = createStarMaterial(materialBackend, { uOpacity: 0 });
        milkyMatRef.current = mat;
        return mat;
    }, [materialBackend]);

    const skyDomeMat = useMemo(() => {
        const mat = createSkyDomeMaterial(materialBackend, {
            zenithColor: new THREE.Color('#4a7ab5'),
            horizonColor: new THREE.Color('#c8d8e8'),
            sunColor: new THREE.Color('#fff4d2'),
            sunDir: new THREE.Vector3(0.3, 1, 0.3),
        });
        skyDomeMatRef.current = mat;
        return mat;
    }, [materialBackend]);


    useEffect(() => {
        scene.userData.skyOwnsFog = true;
        return () => {
            scene.userData.skyOwnsFog = false;
        };
    }, [scene]);

    const overcastBlend = (weatherType === 'overcast' || weatherType === 'storm') ? 1 : weatherType === 'fog' ? 0.5 : 0;

    useFrame((state, delta) => {
        const { currentBiome, transitionProgress } = biomeStore.getState();
        const step = Math.min(1.0, delta * (0.9 + transitionProgress * 0.2));
        const { sun, factors } = getSkyClock();
        const { night, golden, elevation01 } = factors;
        const morningLow = sun.hourAngle < 0 ? (1 - elevation01) * (1 - night) : 0;

        // Fog (and the background it paints): the biome's colour, darkened by
        // night, warmed by the golden hour, cooled by a low morning sun.
        const targetFogColor = _targetFog.set(currentBiome.fogColor);
        targetFogColor.lerp(DAWN_FOG, morningLow * 0.3);
        targetFogColor.lerp(GOLDEN_FOG, golden * 0.25);
        targetFogColor.lerp(NIGHT_FOG, night * 0.85);
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

        // Scattering sky: the clock's sun, hazier toward the horizon.
        const skyUniforms = skyRef.current?.material.uniforms;
        if (skyUniforms) {
            skyUniforms.sunPosition?.value.copy(sunDirection).multiplyScalar(SUN_DISTANCE);
            if (skyUniforms.turbidity) skyUniforms.turbidity.value = skyProfile.turbidity * (1 + 0.35 * golden);
            if (skyUniforms.rayleigh) skyUniforms.rayleigh.value = skyProfile.rayleigh * (1 + 0.4 * (1 - elevation01));
        }

        // Sun glow, stars and the moon sit at infinity: they travel with the camera.
        celestialRef.current?.position.copy(state.camera.position);

        const writeCloud = (mat: THREE.Material | null, time: number, opacity: number) => {
            const u = materialUniformBag(mat);
            if (!u) return;
            if (u.time) u.time.value = time;
            if (u.opacity) u.opacity.value = opacity;
            if (u.sunsetBlend) u.sunsetBlend.value = golden;
            if (u.overcastBlend) u.overcastBlend.value = overcastBlend;
            if (u.sunDir2D?.value instanceof THREE.Vector3) u.sunDir2D.value.copy(sunDirection);
        };
        writeCloud(cloudMatNearRef.current, state.clock.elapsedTime, cloudOpacity);
        writeCloud(cloudMatFarRef.current, state.clock.elapsedTime + 23.0, cloudOpacity * 0.8);

        const starsBlockedByWeather = weatherType === 'overcast' || weatherType === 'fog' || weatherType === 'storm';
        const starAlpha = starsBlockedByWeather ? 0 : night;

        const starNear = materialUniformBag(starsMatRef.current);
        if (starNear?.uTime) starNear.uTime.value = state.clock.elapsedTime;
        if (starNear?.uOpacity) starNear.uOpacity.value = starAlpha;
        const starMilky = materialUniformBag(milkyMatRef.current);
        if (starMilky?.uTime) starMilky.uTime.value = state.clock.elapsedTime;
        const milkyBoost = currentBiome.id === 'midnightMist' ? 1.0 : 0.35;
        if (starMilky?.uOpacity) starMilky.uOpacity.value = starAlpha * milkyBoost;

        const dome = materialUniformBag(skyDomeMatRef.current);
        if (dome?.sunDir?.value instanceof THREE.Vector3) dome.sunDir.value.copy(sunDirection);

        // Moon: opposite the sun's bearing, always above the horizon, fading in at night.
        _moonDir.set(-sun.x, Math.abs(sun.y) * 0.8 + 0.25, -sun.z).normalize();
        if (moonGroupRef.current) {
            moonGroupRef.current.position.copy(_moonDir).multiplyScalar(MOON_DISTANCE);
            const moonScale = Math.max(6, MOON_DISTANCE * 0.045);
            moonGroupRef.current.scale.setScalar(moonScale);
            moonGroupRef.current.lookAt(state.camera.position);
        }
        moonMaterial.opacity = THREE.MathUtils.lerp(moonMaterial.opacity, night, 0.05);
        if (moonLightRef.current) {
            moonLightRef.current.position.copy(_moonDir).multiplyScalar(MOON_DISTANCE);
            moonLightRef.current.intensity = THREE.MathUtils.lerp(
                moonLightRef.current.intensity,
                0.18 * night * (1 - overcastBlend * 0.7),
                0.05
            );
        }

        // Sun glow sprite: bigger and warmer near the horizon, gone below it,
        // at night, or under heavy overcast.
        if (sunGlowRef.current) {
            sunGlowRef.current.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE);
            const glowScale = 28 + (1 - elevation01) * 26;
            sunGlowRef.current.scale.setScalar(glowScale);
            const mat = sunGlowRef.current.material;
            const aboveHorizon = THREE.MathUtils.smoothstep(sun.elevation, -0.035, 0.035);
            mat.opacity = aboveHorizon * (1 - night) * (1 - overcastBlend * 0.8);
            mat.color.copy(SUN_GLOW_DAY).lerp(SUN_GLOW_LOW, Math.max(golden, (1 - elevation01) * 0.6));
        }
    });

    return (
        <group>
            {materialBackend === 'tsl' ? (
                <mesh frustumCulled={false} renderOrder={-10}>
                    <sphereGeometry args={[400, 24, 16]} />
                    <primitive object={skyDomeMat} attach="material" />
                </mesh>
            ) : (
                <Sky
                    ref={skyRef}
                    distance={450000}
                    sunPosition={initialSunPosition}
                    turbidity={skyProfile.turbidity}
                    rayleigh={skyProfile.rayleigh}
                    mieCoefficient={skyProfile.mieCoefficient}
                    mieDirectionalG={skyProfile.mieDirectionalG}
                />
            )}

            <group ref={celestialRef}>
                <sprite ref={sunGlowRef} position={initialSunPosition} scale={[40, 40, 1]}>
                    <spriteMaterial
                        map={sunGlowTexture}
                        transparent
                        depthWrite={false}
                        blending={THREE.AdditiveBlending}
                        opacity={0}
                    />
                </sprite>

                <points geometry={starGeometry} frustumCulled={false} material={starsMat} />
                <points geometry={milkyWayGeometry} frustumCulled={false} material={milkyMat} />

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
            </group>

            <mesh position={[0, 40, 0]} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false}>
                <planeGeometry args={[700, 700, 1, 1]} />
                <primitive object={cloudMatNear} attach="material" />
            </mesh>
            <mesh position={[0, 55, 0]} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false}>
                <planeGeometry args={[820, 820, 1, 1]} />
                <primitive object={cloudMatFar} attach="material" />
            </mesh>

            <fog ref={fogObjRef} attach="fog" args={initialFog} />
        </group>
    );
}
