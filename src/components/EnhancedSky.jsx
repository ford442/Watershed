import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Sky, Stars } from '@react-three/drei';
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
  uniform vec3 cloudColorA;
  uniform vec3 cloudColorB;
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
    vec3 cloudColor = mix(cloudColorA, cloudColorB, sunsetBlend);
    float alpha = cloud * opacity;
    gl_FragColor = vec4(cloudColor, alpha);
  }
`;

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
    const starsRef = useRef();
    const cloudMatNearRef = useRef();
    const cloudMatFarRef = useRef();
    const sunWorldPosRef = useRef(new THREE.Vector3());
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
    const skySunPosition = useMemo(() => {
        const dayArc = (timeOfDay - 0.5) * Math.PI;
        const base = skyProfile.sunPosition;
        const x = base[0] + Math.sin(dayArc) * (isSlotCanyon ? 8 : 24);
        const y = Math.max(8, base[1] + Math.cos(dayArc * 0.85) * 18);
        const z = base[2] + Math.cos(dayArc) * (isSlotCanyon ? 6 : 14);
        return [x, y, z];
    }, [isSlotCanyon, skyProfile.sunPosition, timeOfDay]);

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

        if (cloudMatNearRef.current?.uniforms) {
            cloudMatNearRef.current.uniforms.time.value = state.clock.elapsedTime;
            cloudMatNearRef.current.uniforms.opacity.value = cloudOpacity;
            cloudMatNearRef.current.uniforms.sunsetBlend.value = sunsetBlend;
        }
        if (cloudMatFarRef.current?.uniforms) {
            cloudMatFarRef.current.uniforms.time.value = state.clock.elapsedTime + 23.0;
            cloudMatFarRef.current.uniforms.opacity.value = cloudOpacity * 0.8;
            cloudMatFarRef.current.uniforms.sunsetBlend.value = sunsetBlend;
        }
    });

    const starsBlockedByWeather = weatherType === 'overcast' || weatherType === 'fog' || weatherType === 'storm';
    const showStars = (timeOfDay < 0.1 || timeOfDay > 0.85) && !starsBlockedByWeather;

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

            {showStars && (
                <Stars
                    ref={starsRef}
                    radius={120}
                    depth={60}
                    count={currentBiome.id === 'midnightMist' ? 1400 : 900}
                    factor={isSlotCanyon ? 2.2 : 4.0}
                    saturation={0}
                    fade
                    speed={0.6}
                />
            )}

            {/* Procedural cloud ribbon: two cheap layers, no external assets. */}
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
                        cloudColorA: { value: new THREE.Color('#fff2e2') },
                        cloudColorB: { value: new THREE.Color('#ffcc88') },
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
                        cloudColorA: { value: new THREE.Color('#f8eee0') },
                        cloudColorB: { value: new THREE.Color('#f0b773') },
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
