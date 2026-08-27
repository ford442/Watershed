import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Sky } from '@react-three/drei';
import * as THREE from 'three';
import { useBiome } from '../systems/BiomeSystem';
import { useSunPosition } from '../systems/lighting/SunPositionSystem';
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

interface SkyProfile {
  sunPosition: [number, number, number];
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
}

const SKY_OVERRIDES: Partial<Record<BiomeId | 'pond' | 'slotCanyon', SkyProfile>> = {
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
    glacialMelt: {
        sunPosition: [70, 48, 40],
        turbidity: 4.2,
        rayleigh: 4.8,
        mieCoefficient: 0.0025,
        mieDirectionalG: 0.76,
    },
    glacier: {
        sunPosition: [75, 50, 45],
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

    const hash = (n: number) => {
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
    const hash = (n: number) => {
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

const getSkyProfile = (biomeId: string, isSlotCanyon: boolean): SkyProfile => {
    if (isSlotCanyon && SKY_OVERRIDES.slotCanyon) {
        return SKY_OVERRIDES.slotCanyon;
    }
    return SKY_OVERRIDES[biomeId as keyof typeof SKY_OVERRIDES] || SKY_OVERRIDES.canyonSummer!;
};

export default function EnhancedSky() {
    const { scene } = useThree();
    const { currentBiome, timeOfDay, transitionProgress } = useBiome();
    const { setSunWorldPosition } = useSunPosition();
    const currentSegmentIndex = useGameStore((s) => s.currentSegmentIndex);
    const isSlotCanyon = currentSegmentIndex >= 20 && currentSegmentIndex <= 22;
    const [weatherType, setWeatherType] = useState('clear');
    const materialBackend = useMemo(() => resolveMaterialBackend().backend, []);

    const fogObjRef = useRef<THREE.Fog | null>(null);
    const cloudMatNearRef = useRef<THREE.Material | null>(null);
    const cloudMatFarRef = useRef<THREE.Material | null>(null);
    const starsMatRef = useRef<THREE.Material | null>(null);
    const milkyMatRef = useRef<THREE.Material | null>(null);
    const skyDomeMatRef = useRef<THREE.Material | null>(null);
    const moonGroupRef = useRef<THREE.Group | null>(null);
    const moonLightRef = useRef<THREE.PointLight | null>(null);
    const sunGlowRef = useRef<THREE.Sprite | null>(null);
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

    const skySunPosition = useMemo((): [number, number, number] => {
        const dayArc = (timeOfDay - 0.5) * Math.PI;
        const base = skyProfile.sunPosition;
        const x = base[0] + Math.sin(dayArc) * (isSlotCanyon ? 8 : 24);
        const y = Math.max(8, base[1] + Math.cos(dayArc * 0.85) * 18);
        const z = base[2] + Math.cos(dayArc) * (isSlotCanyon ? 6 : 14);
        return [x, y, z] as [number, number, number];
    }, [isSlotCanyon, skyProfile.sunPosition, timeOfDay]);

    // Moon rides the opposite side of the sky from the sun, on the same arc.
    const moonWorldPosition = useMemo((): [number, number, number] => {
        const dayArc = (timeOfDay - 0.5) * Math.PI + Math.PI;
        const x = Math.sin(dayArc) * 130;
        const y = Math.max(15, Math.cos(dayArc * 0.85) * 70 + 30);
        const z = Math.cos(dayArc) * 110;
        return [x, y, z] as [number, number, number];
    }, [timeOfDay]);

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
        const onWeatherUpdate = (event: Event) => {
            const incoming = (event as CustomEvent<{ type?: string }>)?.detail?.type;
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

        const writeCloud = (mat: THREE.Material | null, time: number, opacity: number) => {
            const u = materialUniformBag(mat);
            if (!u) return;
            if (u.time) u.time.value = time;
            if (u.opacity) u.opacity.value = opacity;
            if (u.sunsetBlend) u.sunsetBlend.value = sunsetBlend;
            if (u.overcastBlend) u.overcastBlend.value = overcastBlend;
            if (u.sunDir2D?.value instanceof THREE.Vector3) u.sunDir2D.value.copy(sunDirNorm);
        };
        writeCloud(cloudMatNearRef.current, state.clock.elapsedTime, cloudOpacity);
        writeCloud(cloudMatFarRef.current, state.clock.elapsedTime + 23.0, cloudOpacity * 0.8);

        const starsBlockedByWeather = weatherType === 'overcast' || weatherType === 'fog' || weatherType === 'storm';
        const starAlpha = starsBlockedByWeather ? 0 : nightFactor;

        const starNear = materialUniformBag(starsMatRef.current);
        if (starNear?.uTime) starNear.uTime.value = state.clock.elapsedTime;
        if (starNear?.uOpacity) starNear.uOpacity.value = starAlpha;
        const starMilky = materialUniformBag(milkyMatRef.current);
        if (starMilky?.uTime) starMilky.uTime.value = state.clock.elapsedTime;
        const milkyBoost = currentBiome.id === 'midnightMist' ? 1.0 : 0.35;
        if (starMilky?.uOpacity) starMilky.uOpacity.value = starAlpha * milkyBoost;

        const dome = materialUniformBag(skyDomeMatRef.current);
        if (dome?.sunDir?.value instanceof THREE.Vector3) dome.sunDir.value.copy(sunDirNorm);

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

    return (
        <group>
            {materialBackend === 'tsl' ? (
                <mesh frustumCulled={false} renderOrder={-10}>
                    <sphereGeometry args={[400, 24, 16]} />
                    <primitive object={skyDomeMat} attach="material" />
                </mesh>
            ) : (
                <Sky
                    distance={450000}
                    sunPosition={skySunPosition}
                    turbidity={skyProfile.turbidity}
                    rayleigh={skyProfile.rayleigh}
                    mieCoefficient={skyProfile.mieCoefficient}
                    mieDirectionalG={skyProfile.mieDirectionalG}
                />
            )}

            <sprite ref={sunGlowRef} position={skySunPosition} scale={[40, 40, 1]}>
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

            <mesh position={[0, 40, 0]} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false}>
                <planeGeometry args={[700, 700, 1, 1]} />
                <primitive object={cloudMatNear} attach="material" />
            </mesh>
            <mesh position={[0, 55, 0]} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false}>
                <planeGeometry args={[820, 820, 1, 1]} />
                <primitive object={cloudMatFar} attach="material" />
            </mesh>

            <fog ref={fogObjRef} attach="fog" args={[currentBiome.fogColor, currentBiome.fogNear, currentBiome.fogFar]} />
        </group>
    );
}
