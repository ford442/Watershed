/**
 * headlessWater.ts — the water the runner floats in, stepped without React (#556 B.1).
 *
 * Two page components run the water each frame, after the SimCore step:
 *
 *   - WaterForceSystem (src/systems/water/WaterForceSystem.tsx) places the
 *     SWE window on the vehicle, steps the field and applies buoyancy / drag.
 *     Its field half (`sweHostFrame`) and force half (`applyWaterForces`) are
 *     plain modules; the component is the lifecycle around them. `frame()`
 *     below is that component's useFrame body for a session on the main-thread
 *     WASM stepper (what a scripted or replay page always runs: sweBackend
 *     `scripted-run`).
 *   - SplashSystem queues the SWE disturbances a body entering and moving
 *     through water makes (`injectSWEDisturbance`); `splash()` is its gates
 *     and nothing of its particles. Foam draws from the run's stream
 *     (`simCore.ctx.rng`) two numbers per eligible frame, exactly as the
 *     component does, so the stream stays aligned.
 *
 * Both are copies of component bodies (a headless run cannot mount them); the
 * campaign pin fails when they drift from the page (the SWE checksums).
 */
import * as THREE from 'three';
import { WATER_LEVEL } from '../../constants/game';
import type { WatershedNativeModule } from '../../systems/water/wasmAbi';
import { createWasmSweSim, type SweSim } from '../../systems/water/sweSim';
import type { SWEFlowSample } from '../../systems/water/sampleSWEFlow';
import {
  clearSWEHeightField,
  consumeSWEDisturbances,
  injectSWEDisturbance,
  setSWEActiveBudget,
} from '../../systems/water/SWEHeightField';
import { sweBudgetForQuality, type SWEBudget } from '../../systems/water/sweQuality';
import { clearSWEBedSnapshot } from '../../systems/water/sweBedDebug';
import { SWE_FLOW_CHANNELS } from '../../systems/water/sweSurfaceField';
import {
  collectWaterForceBodies,
  registerVehicleWaterBody,
  setSweReadiness,
  setWaterForceSystemActive,
} from '../../systems/water/WaterForceRegistry';
import {
  createSweHostState,
  disposeSweHostRouters,
  resetSweHostForGrid,
  sweHostFrame,
  type SweHostState,
} from '../../systems/water/sweHost';
import { applyWaterForces } from '../../systems/water/waterForceBridge';
import { isPhysicsWorkerActive } from '../../physics/physicsWorkerRegistry';
import { getActiveGameplayProfile } from '../../systems/gameplay/activeGameplayProfile';
import { getActiveWeather } from '../../systems/journey/runSession';
import { weatherHullScale } from '../../systems/map/weatherInflow';
import { resolveSplashFrameEvents } from '../../systems/water/splashSpawnMath';
import { simCore } from '../core/SimCore';
import type { QualityPreset } from '../../systems/GameState';
import type { RapierBody } from '../../physics/rapierTypes';

/** WaterPhysicsEffects' props for the runner (experience/WaterStack.tsx). */
const SPLASH_WATER_WIDTH = 12;
const SPLASH_PROXIMITY = 1.0;
const SPLASH_MAX_VELOCITY = 15;
const SPLASH_FLOW_SPEED = 1;
const SPLASH_PARTICLE_DENSITY = 1;
const TURBULENCE_STRENGTH = 0.1;
const TURBULENCE_FREQUENCY = 2.4;

function halfFloatTexture(width: number, height: number, channels: number, format: THREE.PixelFormat): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Uint16Array(width * height * channels),
    width,
    height,
    format,
    THREE.HalfFloatType,
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

export interface HeadlessWater {
  readonly budget: SWEBudget;
  readonly host: SweHostState;
  /** The field's grid (null at `low`, which allocates none). */
  readonly grid: SweSim | null;
  /** The flow the field gave the vehicle at the last frame (what the page's `waterForce` tap reads), or null before one. */
  readonly lastFlow: SWEFlowSample | null;
  /** Where the SWE window's cell (0, 0) sat at the last frame. */
  readonly lastOrigin: { readonly x: number; readonly z: number };
  /** WaterForceSystem's frame: the field, then the forces on the vehicle. `delta` is the R3F delta, `elapsed` its clock. */
  frame(delta: number, elapsed: number): void;
  /** SplashSystem's frame: the SWE disturbances the body's water contact queues. */
  splash(body: RapierBody): void;
  dispose(): void;
}

export function createHeadlessWater(
  native: WatershedNativeModule,
  quality: QualityPreset,
  body: RapierBody,
): HeadlessWater {
  const budget = sweBudgetForQuality(quality);
  setSWEActiveBudget(budget);
  // A previous run's last frame queued disturbances nobody consumed; they are not this run's.
  consumeSWEDisturbances();
  setWaterForceSystemActive(true);
  const host = createSweHostState();
  const textures: THREE.DataTexture[] = [];
  let grid: SweSim | null = null;
  if (budget.enabled) {
    grid = createWasmSweSim(native, budget.width, budget.height, budget.cellSize);
    host.grid = grid;
    host.texture = halfFloatTexture(budget.width, budget.height, 1, THREE.RedFormat);
    host.flowTexture = halfFloatTexture(budget.width, budget.height, SWE_FLOW_CHANNELS, THREE.RGBAFormat);
    textures.push(host.texture, host.flowTexture);
    resetSweHostForGrid(host);
    setSweReadiness('ready');
  } else {
    setSweReadiness('off');
  }

  registerVehicleWaterBody({
    translation: () => body.translation(),
    linvel: () => body.linvel(),
    applyImpulse: (impulse, wake) => body.applyImpulse(impulse, wake),
  });

  let wasInWater = false;
  let lastFlow: SWEFlowSample | null = null;
  const lastOrigin = { x: 0, z: 0 };

  return {
    budget,
    host,
    grid,
    get lastFlow() {
      return lastFlow;
    },
    lastOrigin,
    frame(delta, elapsed) {
      const bodies = collectWaterForceBodies();
      if (bodies.length === 0) return;
      const dt = Math.min(delta, 0.05);
      const hull = weatherHullScale(getActiveWeather());
      const hullFlowSpeed = getActiveGameplayProfile().flowCap * hull.flowCapScale;
      const anchor = body.translation();
      const field = sweHostFrame(host, budget, native, anchor, dt);
      const forces = applyWaterForces({
        bodies,
        vehicleBody: body,
        vehicleType: 'runner',
        workerOwnsVehicleForces: isPhysicsWorkerActive(),
        anchor,
        grid: host.grid,
        originX: field.originX,
        originZ: field.originZ,
        sweEnabled: field.sweEnabled,
        dt,
        timeSeconds: elapsed,
        flowSpeed: hullFlowSpeed,
        waterLevel: WATER_LEVEL,
        turbulenceStrength: TURBULENCE_STRENGTH,
        turbulenceFrequency: TURBULENCE_FREQUENCY,
        dragScale: hull.dragScale,
        simProxy: null,
        requests: null,
        vehicleFlowRef: { current: null },
      });
      lastFlow = forces.vehicleFlow;
      lastOrigin.x = field.originX;
      lastOrigin.z = field.originZ;
    },
    splash(vehicle) {
      const pos = vehicle.translation();
      const vel = vehicle.linvel();
      const speed = Math.sqrt(vel.x ** 2 + vel.z ** 2);
      const isInWater = pos.y < WATER_LEVEL && Math.abs(pos.x) < SPLASH_WATER_WIDTH / 2;
      const isNearWater = Math.abs(pos.y - WATER_LEVEL) < SPLASH_PROXIMITY;
      // The cruise cooldown only gates particles; the disturbance gates below never read it.
      const events = resolveSplashFrameEvents(
        wasInWater,
        isInWater,
        isNearWater,
        speed,
        SPLASH_MAX_VELOCITY,
        SPLASH_FLOW_SPEED,
        SPLASH_PARTICLE_DENSITY,
        1,
      );
      wasInWater = isInWater;
      if (events.entrySplash) injectSWEDisturbance(pos.x, pos.z, 2.2, 0.55);
      else if (events.exitSplash) injectSWEDisturbance(pos.x, pos.z, 1.4, 0.28);
      if (events.foamEligible) {
        // Two draws every eligible frame, whatever happens, so the stream stays aligned.
        const foamRoll = simCore.ctx.rng();
        const disturbRoll = simCore.ctx.rng();
        if (foamRoll < 0.1 * speed && disturbRoll < 0.15) injectSWEDisturbance(pos.x, pos.z, 0.9, 0.08);
      }
    },
    dispose() {
      disposeSweHostRouters(host);
      grid?.dispose();
      for (const texture of textures) texture.dispose();
      registerVehicleWaterBody(null);
      setWaterForceSystemActive(false);
      setSweReadiness('pending');
      clearSWEHeightField();
      clearSWEBedSnapshot();
    },
  };
}
