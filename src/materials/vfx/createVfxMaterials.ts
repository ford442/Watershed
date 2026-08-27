import * as THREE from 'three';
import type { MaterialBackend } from '../../rendering/materialBackend';
import { createDualVfxMaterial } from './vfxDualFactory';
import * as VfxNodes from './VfxNodeMaterials';
import {
  POND_FOG_FRAGMENT,
  POND_FOG_VERTEX,
  RAINBOW_FRAGMENT,
  RAINBOW_VERTEX,
  SPLASH_BOW_FRAGMENT,
  SPLASH_BOW_VERTEX,
  SUN_SHAFT_MOTE_FRAGMENT,
  SUN_SHAFT_MOTE_VERTEX,
  VFX_NOISE_HELPERS,
} from './vfxGlslShaders';

export function createRainbowMaterial(
  backend: MaterialBackend,
  init: { opacity: number; sunDirection: THREE.Vector3 },
): THREE.Material {
  return createDualVfxMaterial(
    backend,
    'createRainbowMaterial',
    {
      vertexShader: RAINBOW_VERTEX,
      fragmentShader: RAINBOW_FRAGMENT,
      uniforms: {
        time: { value: 0 },
        opacity: { value: init.opacity },
        sunDirection: { value: init.sunDirection.clone().normalize() },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    },
    () => VfxNodes.createRainbowNodeMaterial(init) as unknown as THREE.Material,
  );
}

export function createPondFogMaterial(
  backend: MaterialBackend,
  init: { tintColor: THREE.Color },
): THREE.Material {
  return createDualVfxMaterial(
    backend,
    'createPondFogMaterial',
    {
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      uniforms: {
        time: { value: 0 },
        opacity: { value: 0 },
        tintColor: { value: init.tintColor.clone() },
      },
      vertexShader: POND_FOG_VERTEX,
      fragmentShader: POND_FOG_FRAGMENT,
    },
    () =>
      VfxNodes.createPondFogNodeMaterial({ tintColor: init.tintColor }) as unknown as THREE.Material,
  );
}

export function createSplashBowWaveMaterial(backend: MaterialBackend): THREE.Material {
  return createDualVfxMaterial(
    backend,
    'createSplashBowWaveMaterial',
    {
      uniforms: { time: { value: 0 } },
      vertexShader: SPLASH_BOW_VERTEX,
      fragmentShader: SPLASH_BOW_FRAGMENT,
      transparent: true,
      side: THREE.DoubleSide,
    },
    () => VfxNodes.createSplashBowWaveNodeMaterial() as unknown as THREE.Material,
  );
}

export interface WaterfallSheetInit {
  flowSpeed: number;
  baseOpacity: number;
  layerOffset: number;
  waterColor: THREE.Color;
  deepColor: THREE.Color;
  foamColor: THREE.Color;
}

export function createWaterfallSheetMaterial(
  backend: MaterialBackend,
  init: WaterfallSheetInit,
): THREE.Material {
  return createDualVfxMaterial(
    backend,
    'createWaterfallSheetMaterial',
    {
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        time: { value: 0 },
        flowSpeed: { value: init.flowSpeed },
        baseOpacity: { value: init.baseOpacity },
        layerOffset: { value: init.layerOffset },
        waterColor: { value: init.waterColor.clone() },
        deepColor: { value: init.deepColor.clone() },
        foamColor: { value: init.foamColor.clone() },
      },
      vertexShader: `
        uniform float time;
        uniform float flowSpeed;
        uniform float layerOffset;
        attribute float curtainDepth;
        varying vec2 vUv;
        varying float vDepth;
        varying float vFoamBias;
        varying vec3 vWorldPos;
        ${VFX_NOISE_HELPERS}
        void main() {
          vUv = uv;
          vDepth = curtainDepth;
          float billow = sin((position.y * 0.18) + time * 0.8 + layerOffset) * 0.12;
          billow += fbm(vec2(position.x * 0.14 + layerOffset, position.y * 0.08 - time * 0.35)) * 0.18;
          float basePull = smoothstep(0.45, 1.0, curtainDepth) * 0.25;
          vec3 transformed = position;
          transformed.x += billow * (0.45 + curtainDepth * 0.55);
          transformed.z += basePull + sin(position.x * 0.2 + time * 0.5 + layerOffset) * 0.08;
          vFoamBias = smoothstep(0.55, 1.0, curtainDepth);
          vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float flowSpeed;
        uniform float baseOpacity;
        uniform float layerOffset;
        uniform vec3 waterColor;
        uniform vec3 deepColor;
        uniform vec3 foamColor;
        varying vec2 vUv;
        varying float vDepth;
        varying float vFoamBias;
        varying vec3 vWorldPos;
        ${VFX_NOISE_HELPERS}
        void main() {
          vec2 streakUv = vec2(vUv.x * 1.9 + layerOffset, (1.0 - vUv.y) * 3.6 + time * flowSpeed * 2.8);
          float streaks = fbm(streakUv);
          float foam = smoothstep(0.52, 0.84, streaks);
          float edgeThin = smoothstep(0.0, 0.16, vUv.x) * (1.0 - smoothstep(0.84, 1.0, vUv.x));
          float baseFoam = smoothstep(0.62, 1.0, vDepth);
          float lipFade = 1.0 - smoothstep(0.0, 0.12, vUv.y);
          vec3 color = mix(waterColor, deepColor, smoothstep(0.05, 0.9, vDepth));
          color += foamColor * foam * (0.16 + baseFoam * 0.55);
          color += foamColor * baseFoam * 0.24;
          float fresnel = pow(1.0 - abs(dot(normalize(cameraPosition - vWorldPos), vec3(0.0, 0.0, 1.0))), 2.0);
          color += vec3(0.12, 0.18, 0.22) * fresnel;
          float alpha = baseOpacity * edgeThin * (0.55 + foam * 0.2 + baseFoam * 0.35);
          alpha *= (1.0 - lipFade * 0.22);
          gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.95));
        }
      `,
    },
    () => VfxNodes.createWaterfallSheetNodeMaterial(init) as unknown as THREE.Material,
  );
}

export function createWaterfallPlumeMaterial(
  backend: MaterialBackend,
  init: { intensity: number; colorBase: THREE.Color },
): THREE.Material {
  return createDualVfxMaterial(
    backend,
    'createWaterfallPlumeMaterial',
    {
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        time: { value: 0 },
        intensity: { value: init.intensity },
        colorBase: { value: init.colorBase.clone() },
      },
      vertexShader: `
        uniform float time;
        uniform float intensity;
        varying vec2 vUv;
        varying float vAlpha;
        ${VFX_NOISE_HELPERS}
        void main() {
          vUv = uv;
          vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          vec3 viewRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 viewUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float rand = hash(instancePos.xz * 1.7 + vec2(instancePos.y));
          float sway = sin(time * 0.7 + rand * 8.0 + position.y * 2.2) * 0.25;
          float lift = abs(sin(time * 0.5 + rand * 6.0)) * 0.35;
          float widthScale = 2.2 + rand * 1.6;
          float heightScale = 2.8 + rand * 3.5;
          vec3 finalPos = instancePos;
          finalPos += viewRight * (position.x + sway) * widthScale;
          finalPos += viewUp * (position.y + lift) * heightScale;
          gl_Position = projectionMatrix * viewMatrix * vec4(finalPos, 1.0);
          vAlpha = (1.0 - uv.y) * (0.28 + rand * 0.2) * intensity;
        }
      `,
      fragmentShader: `
        uniform vec3 colorBase;
        varying vec2 vUv;
        varying float vAlpha;
        ${VFX_NOISE_HELPERS}
        void main() {
          vec2 centered = vUv - 0.5;
          float radial = smoothstep(0.55, 0.0, length(centered * vec2(1.0, 1.5)));
          float wisps = noise(vUv * 5.0 + vec2(0.0, vUv.y * 2.0));
          float alpha = radial * smoothstep(0.2, 0.85, wisps) * vAlpha;
          gl_FragColor = vec4(colorBase, alpha);
        }
      `,
    },
    () => VfxNodes.createWaterfallPlumeNodeMaterial(init) as unknown as THREE.Material,
  );
}

export function createWaterfallFoamMaterial(
  backend: MaterialBackend,
  init: { flowSpeed: number; churnBoost: number; colorBase: THREE.Color },
): THREE.Material {
  return createDualVfxMaterial(
    backend,
    'createWaterfallFoamMaterial',
    {
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        time: { value: 0 },
        flowSpeed: { value: init.flowSpeed },
        churnBoost: { value: init.churnBoost },
        colorBase: { value: init.colorBase.clone() },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float flowSpeed;
        uniform float churnBoost;
        uniform vec3 colorBase;
        varying vec2 vUv;
        ${VFX_NOISE_HELPERS}
        void main() {
          vec2 centered = vUv - 0.5;
          float dist = length(centered);
          float ring = smoothstep(0.48, 0.12, dist);
          float core = smoothstep(0.22, 0.0, dist);
          float swirl = noise(centered * 7.0 + vec2(time * flowSpeed * 0.35, -time * flowSpeed * 0.25));
          float churn = noise(centered * 12.0 + vec2(-time * flowSpeed * 0.6, time * flowSpeed * 0.45));
          float foam = smoothstep(0.38, 0.95, swirl * 0.55 + churn * 0.45);
          float alpha = (ring * 0.45 + core * 0.35) * foam * (0.7 + churnBoost * 0.2);
          gl_FragColor = vec4(colorBase, alpha);
        }
      `,
    },
    () => VfxNodes.createWaterfallFoamNodeMaterial(init) as unknown as THREE.Material,
  );
}

export function createSunShaftMaterial(
  backend: MaterialBackend,
  init: {
    flowSpeed: number;
    shaftOpacity: number;
    colorBase: THREE.Color;
    warmTint: THREE.Color;
    timeOfDay: number;
  },
): THREE.Material {
  return createDualVfxMaterial(
    backend,
    'createSunShaftMaterial',
    {
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        time: { value: 0 },
        colorBase: { value: init.colorBase.clone() },
        warmTint: { value: init.warmTint.clone() },
        flowSpeed: { value: init.flowSpeed },
        shaftOpacity: { value: init.shaftOpacity },
        timeOfDay: { value: init.timeOfDay },
        speedStreak: { value: 0 },
        sunDirection: { value: new THREE.Vector3(0.1, 1.0, 0.05).normalize() },
        overcastBlend: { value: 0 },
      },
      vertexShader: `
        uniform float time;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        varying float vAlpha;
        float hash(float n) { return fract(sin(n) * 43758.5453123); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123); }
        void main() {
          vUv = uv;
          vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float rand = hash(instancePos.xz * 12.0);
          vec3 pos = position;
          float swaySpeed = 0.5 + rand * 0.5;
          pos.x += sin(time * swaySpeed + pos.y * 0.1 + rand * 10.0) * 0.5;
          vec4 worldPosition = modelMatrix * instanceMatrix * vec4(pos, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
          vAlpha = 0.6 + rand * 0.4;
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 colorBase;
        uniform vec3 warmTint;
        uniform float flowSpeed;
        uniform float shaftOpacity;
        uniform float timeOfDay;
        uniform float speedStreak;
        uniform vec3 sunDirection;
        uniform float overcastBlend;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        varying float vAlpha;
        ${VFX_NOISE_HELPERS}
        void main() {
          float verticalFade = smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.8, 1.0, vUv.y));
          float noiseA = fbm(vWorldPosition.xz * 0.3 + vec2(0.0, -time * (0.5 + flowSpeed * 0.3)));
          float shaft = smoothstep(0.3, 0.7, noiseA);
          float edge = pow(1.0 - abs(vUv.x * 2.0 - 1.0), 1.5);
          shaft *= (0.55 + 0.45 * edge);
          float streaks = sin((vUv.y + time * (1.2 + flowSpeed * 0.6)) * 35.0 + vUv.x * 20.0) * 0.5 + 0.5;
          streaks = smoothstep(0.82, 1.0, streaks) * speedStreak;
          float midday = max(0.0, 1.0 - abs(timeOfDay - 0.5) * 2.0);
          float goldenHour = smoothstep(0.65, 0.9, timeOfDay);
          vec3 shaftColor = mix(colorBase, warmTint, goldenHour * 0.7);
          float sunFacing = clamp(dot(normalize(sunDirection), vec3(0.0, 1.0, 0.0)), 0.2, 1.0);
          shaft = mix(shaft, 0.45, overcastBlend * 0.6);
          shaftColor = mix(shaftColor, vec3(0.82, 0.85, 0.9), overcastBlend * 0.7);
          float alpha = vAlpha * verticalFade * shaft * shaftOpacity * (0.65 + midday * 0.35) * sunFacing;
          alpha += streaks * 0.12 * (1.0 - overcastBlend * 0.6);
          gl_FragColor = vec4(shaftColor, alpha);
        }
      `,
    },
    () =>
      VfxNodes.createSunShaftNodeMaterial({
        flowSpeed: init.flowSpeed,
        shaftOpacity: init.shaftOpacity,
        colorBase: init.colorBase,
        warmTint: init.warmTint,
      }) as unknown as THREE.Material,
  );
}

export function createSunShaftMoteMaterial(
  backend: MaterialBackend,
  init: { colorBase: THREE.Color; opacity: number; flowSpeed: number },
): THREE.Material {
  return createDualVfxMaterial(
    backend,
    'createSunShaftMoteMaterial',
    {
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        time: { value: 0 },
        flowSpeed: { value: init.flowSpeed },
        colorBase: { value: init.colorBase.clone() },
        opacity: { value: init.opacity },
        sunFacing: { value: 1.0 },
      },
      vertexShader: SUN_SHAFT_MOTE_VERTEX,
      fragmentShader: SUN_SHAFT_MOTE_FRAGMENT,
    },
    () =>
      VfxNodes.createSunShaftMoteNodeMaterial({
        colorBase: init.colorBase,
        opacity: init.opacity,
      }) as unknown as THREE.Material,
  );
}

export function createMistMaterial(
  backend: MaterialBackend,
  init: { colorBase: THREE.Color; flowSpeed: number; isSlotCanyon: boolean },
): THREE.Material {
  return createDualVfxMaterial(
    backend,
    'createMistMaterial',
    {
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        time: { value: 0 },
        colorBase: { value: init.colorBase.clone() },
        flowSpeed: { value: init.flowSpeed },
        playerVelocity: { value: 0 },
        isSlotCanyon: { value: init.isSlotCanyon ? 1.0 : 0.0 },
        playerPos: { value: new THREE.Vector3(0, -1000, 0) },
        tintColor: { value: init.colorBase.clone() },
        tintStrength: { value: 0 },
        stormBlend: { value: 0 },
      },
      vertexShader: `
        uniform float time;
        uniform float flowSpeed;
        uniform float playerVelocity;
        uniform float isSlotCanyon;
        uniform vec3 playerPos;
        uniform float stormBlend;
        varying float vAlpha;
        varying vec2 vUv;
        varying float vType;
        float hash(float n) { return fract(sin(n) * 43758.5453123); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123); }
        attribute vec3 instanceScale;
        attribute float mistType;
        void main() {
          vUv = uv;
          vType = mistType;
          vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float rand = hash(instancePos.xz * 12.0);
          vec3 viewRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 viewUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float driftSpeed = 0.2 + rand * 0.2;
          vec3 drift = vec3(0.0);
          float flowInfluence = 1.0 + flowSpeed * 0.5;
          drift.x = sin(time * driftSpeed + rand * 10.0) * 0.3 * flowInfluence;
          drift.y = abs(sin(time * driftSpeed * 0.3 + rand * 20.0)) * 0.4 * (1.0 + flowSpeed * 0.3);
          drift.z = cos(time * driftSpeed + rand * 10.0) * 0.35 * flowInfluence;
          if (isSlotCanyon > 0.5) drift.y += 0.12 + mistType * 0.25;
          vec2 toMote = instancePos.xz - playerPos.xz;
          float distToPlayer = length(toMote);
          float pushRadius = 4.5 + clamp(playerVelocity, 0.0, 45.0) * 0.04;
          if (distToPlayer < pushRadius && distToPlayer > 0.001) {
            float pushAmt = (1.0 - distToPlayer / pushRadius);
            pushAmt = pushAmt * pushAmt * (1.5 + clamp(playerVelocity, 0.0, 45.0) * 0.05);
            drift.xz += normalize(toMote) * pushAmt;
          }
          float baseScale = max(0.2, instanceScale.x) * (2.0 + rand * 1.2);
          float verticalScale = max(0.2, instanceScale.y) * (1.8 + rand * 1.0);
          float velocityStretch = 1.0 + clamp(playerVelocity, 0.0, 45.0) * 0.04;
          vec3 finalPos = instancePos + drift;
          finalPos += viewRight * position.x * baseScale;
          finalPos += viewUp * position.y * verticalScale * velocityStretch;
          gl_Position = projectionMatrix * viewMatrix * vec4(finalPos, 1.0);
          float pulse = sin(time * 0.5 + rand * 10.0);
          vAlpha = mix(0.28 + 0.18 * pulse, 0.35 + 0.22 * pulse, clamp(mistType, 0.0, 1.0));
          vAlpha *= mix(1.0, 1.35, stormBlend);
        }
      `,
      fragmentShader: `
        uniform vec3 colorBase;
        uniform vec3 tintColor;
        uniform float tintStrength;
        uniform float stormBlend;
        varying float vAlpha;
        varying vec2 vUv;
        varying float vType;
        void main() {
          float alpha = smoothstep(0.5, 0.0, distance(vUv, vec2(0.5)));
          float columnBoost = mix(1.0, 1.2, clamp(vType, 0.0, 1.0));
          vec3 finalColor = mix(colorBase, tintColor, tintStrength);
          finalColor = mix(finalColor, finalColor * 0.55, stormBlend);
          gl_FragColor = vec4(finalColor, alpha * vAlpha * columnBoost);
        }
      `,
    },
    () => VfxNodes.createMistNodeMaterial({ colorBase: init.colorBase }) as unknown as THREE.Material,
  );
}

export function createFireflyMaterial(
  backend: MaterialBackend,
  init: { colorBase: THREE.Color },
): THREE.Material {
  return createDualVfxMaterial(
    backend,
    'createFireflyMaterial',
    {
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        time: { value: 0 },
        colorBase: { value: init.colorBase.clone() },
      },
      vertexShader: `
        uniform float time;
        varying float vAlpha;
        varying vec3 vColorMult;
        float hash(float n) { return fract(sin(n) * 43758.5453123); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123); }
        void main() {
          vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float rand = hash(instancePos.xz);
          float rand2 = hash(instancePos.zx);
          float swarmSpeed = 0.4 + rand2 * 0.6;
          float swarmRadius = 0.4 + rand * 0.9;
          float swarmAngle = time * swarmSpeed + rand * 6.2831;
          float floatSpeed = 0.5 + rand * 0.5;
          float floatAmp = 0.3 + rand * 0.35;
          vec3 offset = vec3(0.0);
          offset.x = cos(swarmAngle) * swarmRadius + sin(time * floatSpeed + rand * 10.0) * floatAmp;
          offset.y = sin(time * floatSpeed * 1.3 + rand2 * 10.0) * floatAmp * 0.6 + sin(swarmAngle * 1.5) * 0.25;
          offset.z = sin(swarmAngle) * swarmRadius + cos(time * floatSpeed * 0.8 + rand * 20.0) * floatAmp;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          mvPosition.xyz += offset;
          gl_Position = projectionMatrix * mvPosition;
          float blink = smoothstep(-0.2, 0.8, sin(time * (2.0 + rand * 3.0) + rand * 10.0));
          vAlpha = 0.3 + 0.7 * blink;
          vColorMult = vec3(1.0);
          if (rand > 0.7) vColorMult = vec3(0.8, 1.0, 0.5);
          else if (rand < 0.3) vColorMult = vec3(1.0, 0.6, 0.2);
        }
      `,
      fragmentShader: `
        uniform vec3 colorBase;
        varying float vAlpha;
        varying vec3 vColorMult;
        void main() {
          gl_FragColor = vec4(colorBase * vColorMult, vAlpha);
        }
      `,
    },
    () => VfxNodes.createFireflyNodeMaterial(init) as unknown as THREE.Material,
  );
}

export function createCanyonDustMaterial(
  backend: MaterialBackend,
  init: { colorBase: THREE.Color; flowSpeed: number },
): THREE.Material {
  return createDualVfxMaterial(
    backend,
    'createCanyonDustMaterial',
    {
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        time: { value: 0 },
        flowSpeed: { value: init.flowSpeed },
        playerVelocity: { value: 0 },
        colorBase: { value: init.colorBase.clone() },
        densityMul: { value: 1.0 },
      },
      vertexShader: `
        uniform float time;
        uniform float flowSpeed;
        uniform float playerVelocity;
        uniform float densityMul;
        attribute vec3 instanceScale;
        varying float vAlpha;
        varying vec2 vUv;
        float hash(float n) { return fract(sin(n) * 43758.5453123); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123); }
        void main() {
          vUv = uv;
          vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float rand = hash(instancePos.xz * 11.0);
          vec3 viewRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 viewUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 drift = vec3(0.0);
          drift.x = sin(time * (0.6 + rand * 0.5) + rand * 8.0) * 0.25;
          drift.y = abs(sin(time * 0.35 + rand * 20.0)) * (0.18 + flowSpeed * 0.1);
          drift.z = cos(time * (0.7 + rand * 0.4) + rand * 12.0) * 0.25;
          drift.z += -playerVelocity * 0.12;
          float streakScale = 1.0 + clamp(playerVelocity, 0.0, 45.0) * 0.03;
          vec3 finalPos = instancePos + drift;
          finalPos += viewRight * position.x * instanceScale.x;
          finalPos += viewUp * position.y * instanceScale.y * streakScale;
          gl_Position = projectionMatrix * viewMatrix * vec4(finalPos, 1.0);
          float pulse = sin(time * 1.4 + rand * 20.0) * 0.5 + 0.5;
          vAlpha = mix(0.05, 0.12, pulse) * densityMul;
        }
      `,
      fragmentShader: `
        uniform vec3 colorBase;
        varying float vAlpha;
        varying vec2 vUv;
        void main() {
          float alpha = smoothstep(0.5, 0.0, distance(vUv, vec2(0.5)));
          gl_FragColor = vec4(colorBase, alpha * vAlpha);
        }
      `,
    },
    () => VfxNodes.createCanyonDustNodeMaterial({ colorBase: init.colorBase }) as unknown as THREE.Material,
  );
}

export function createRockFoamMaterial(
  backend: MaterialBackend,
  init: { colorBase: THREE.Color; flowSpeed: number },
): THREE.Material {
  return createDualVfxMaterial(
    backend,
    'createRockFoamMaterial',
    {
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        time: { value: 0 },
        flowSpeed: { value: init.flowSpeed },
        colorBase: { value: init.colorBase.clone() },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float flowSpeed;
        uniform vec3 colorBase;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f*f*(3.0-2.0*f);
            return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), f.x),
                       mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), f.x), f.y);
        }
        void main() {
          float dist = distance(vUv, vec2(0.5));
          float mask = smoothstep(0.5, 0.0, dist);
          mask = pow(mask, 2.0);
          float flow = time * flowSpeed;
          float n1 = noise(vUv * 8.0 + vec2(0.0, -flow * 2.0));
          float n2 = noise(vUv * 3.0 + vec2(0.0, -flow * 0.8));
          float foam = n1 * 0.6 + n2 * 0.4;
          foam = smoothstep(0.3, 0.9, foam);
          float alpha = mask * foam * 0.6;
          gl_FragColor = vec4(colorBase, alpha);
        }
      `,
    },
    () => VfxNodes.createRockFoamNodeMaterial(init) as unknown as THREE.Material,
  );
}
