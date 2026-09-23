/**
 * WaterForceSystem — production WASM water coupling.
 *
 * - Steps a player-centered SWE grid and uploads height data for FlowingWater.
 * - Applies native buoyancy + current drag to the vehicle and floating debris
 *   using SWE-sampled flowDir / speed (sampleSWEFlow → calculateWaterForce).
 * - Falls back to pure TypeScript force math when WASM is unavailable.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { WATER_LEVEL } from '../../constants/game';
import { FLOATING_OBJECT } from '../../constants/game';
import { WATER_PHYSICS } from '../../vehicles/RaftVehicle/constants';
import {
  calculateWaterForceFallback,
  getWasm,
  type NativeWaterForceConfig,
  type WatershedNativeModule,
} from './WatershedWasm';
import { createWasmSweSim, type SweEventCall, type SweSim } from './sweSim';
import { createWgslSweSim } from './WgslSweSim';
import { demoteSweSimBackendToWasm, resolveSweSimBackendDecision } from './sweBackend';
import { getSessionGpuDevice } from '../../rendering/gpuChores/device';
import {
  SWE_MEAN_DEPTH,
  consumeSWEDisturbances,
  setSWEActiveBudget,
  updateSWEHeightFieldSnapshot,
  clearSWEHeightField,
} from './SWEHeightField';
import { sweBudgetForQuality, sweStepInterval, type SWEBudget } from './sweQuality';
import {
  getBathymetryRevision,
  getRegisteredBathymetryCount,
  getRegisteredBathymetrySource,
  sampleBathymetryInto,
} from './bathymetrySampler';
import { publishSWEBedSnapshot, clearSWEBedSnapshot } from './sweBedDebug';
import { useQualityPreset } from '../GameState';
import {
  collectWaterForceBodies,
  registerVehicleWaterBody,
  setWaterForceSystemActive,
  type WaterForceBody,
} from './WaterForceRegistry';
import {
  isPhysicsWorkerActive,
  setPhysicsWorkerTickParams,
  setSWEStatus,
} from '../../physics/physicsWorkerRegistry';
import { bindChoreWasm, runHeightfieldChores } from '../../rendering/gpuChores';
import {
  sampleSWEFlow,
  FALLBACK_FLOW_DIR,
  SWE_STAGE_SPEED_BOOST,
  type SWEFlowGrid,
  type SWEFlowSample,
} from './sampleSWEFlow';
import { applyHydroEventsToGrid, parseHydroEvents } from './hydroEvents';
import { getActiveMap } from '../../maps/registry';
import { getActiveLaunchHour } from '../journey/runSession';
import { shouldSkipMainThreadVehicleForce } from '../../physics/waterForceAuthority';
import type { VehicleRigidBodyRef, VehicleType } from '../../experience/types';

const PHYSICS_SCALE = 0.001;

interface WaterForceSystemProps {
  vehicleRef: React.RefObject<VehicleRigidBodyRef | null>;
  vehicleType?: VehicleType;
  flowSpeed?: number;
  waterLevel?: number;
  turbulenceStrength?: number;
  turbulenceFrequency?: number;
}

function vehicleForceConfig(
  vehicleType: VehicleType,
  flowSpeed: number,
  waterLevel: number,
  timeSeconds: number,
  turbulenceStrength: number,
  turbulenceFrequency: number,
): NativeWaterForceConfig {
  if (vehicleType === 'raft') {
    return {
      flowSpeed,
      waterLevel,
      raftMass: WATER_PHYSICS.RAFT_MASS,
      raftVolume: WATER_PHYSICS.RAFT_VOLUME,
      dragCoefficient: WATER_PHYSICS.DRAG_COEFFICIENT,
      frontalArea: WATER_PHYSICS.RAFT_WIDTH * WATER_PHYSICS.RAFT_HEIGHT,
      sideArea: WATER_PHYSICS.RAFT_LENGTH * WATER_PHYSICS.RAFT_HEIGHT,
      timeSeconds,
      turbulenceStrength,
      turbulenceFrequency,
    };
  }

  return {
    flowSpeed,
    waterLevel,
    raftMass: 82,
    raftVolume: 0.08,
    dragCoefficient: 1.0,
    frontalArea: 0.45,
    sideArea: 0.35,
    timeSeconds,
    turbulenceStrength: turbulenceStrength * 0.75,
    turbulenceFrequency,
  };
}

function floatingForceConfig(
  flowSpeed: number,
  waterLevel: number,
  timeSeconds: number,
  body: WaterForceBody,
  turbulenceStrength: number,
  turbulenceFrequency: number,
): NativeWaterForceConfig {
  return {
    flowSpeed: flowSpeed * FLOATING_OBJECT.FLOW_INFLUENCE,
    waterLevel,
    raftMass: (body.mass ?? FLOATING_OBJECT.DEBRIS_DENSITY * FLOATING_OBJECT.DEBRIS_VOLUME) * PHYSICS_SCALE,
    raftVolume: body.volume ?? FLOATING_OBJECT.DEBRIS_VOLUME,
    dragCoefficient: body.dragCoefficient ?? FLOATING_OBJECT.DRAG_COEFFICIENT,
    frontalArea: body.frontalArea ?? FLOATING_OBJECT.DRAG_AREA,
    sideArea: body.sideArea ?? FLOATING_OBJECT.DRAG_AREA * 0.6,
    timeSeconds,
    turbulenceStrength,
    turbulenceFrequency,
  };
}

/**
 * Authored stage applied to the authored water level. Clamped so a numerically
 * hot cell cannot teleport the surface; ±2 m covers every authored event.
 */
export const MAX_STAGE_OFFSET = 2;

export function stagedWaterLevel(waterLevel: number, flow: Pick<SWEFlowSample, 'surfaceOffset'>): number {
  const offset = Number.isFinite(flow.surfaceOffset) ? flow.surfaceOffset : 0;
  return waterLevel + Math.max(-MAX_STAGE_OFFSET, Math.min(MAX_STAGE_OFFSET, offset));
}

function worldToGridIndex(
  worldX: number,
  worldZ: number,
  originX: number,
  originZ: number,
  budget: SWEBudget,
): { gx: number; gz: number } | null {
  const gx = Math.round((worldX - originX) / budget.cellSize);
  const gz = Math.round((worldZ - originZ) / budget.cellSize);
  if (gx < 0 || gx >= budget.width || gz < 0 || gz >= budget.height) return null;
  return { gx, gz };
}

function toFlowGrid(
  grid: SweSim,
  originX: number,
  originZ: number,
): SWEFlowGrid {
  return {
    h: grid.h,
    u: grid.u,
    w: grid.w,
    b: grid.b,
    width: grid.width,
    height: grid.height,
    cellSize: grid.dx,
    originX,
    originZ,
  };
}

function applyDisturbances(
  grid: SweSim,
  originX: number,
  originZ: number,
  disturbances: ReturnType<typeof consumeSWEDisturbances>,
  budget: SWEBudget,
): void {
  for (const d of disturbances) {
    const center = worldToGridIndex(d.worldX, d.worldZ, originX, originZ, budget);
    if (!center) continue;

    const radiusCells = Math.max(1, Math.ceil(d.radius / budget.cellSize));
    for (let dz = -radiusCells; dz <= radiusCells; dz += 1) {
      for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
        const gx = center.gx + dx;
        const gz = center.gz + dz;
        if (gx < 0 || gx >= grid.width || gz < 0 || gz >= grid.height) continue;
        const dist = Math.hypot(dx, dz) * budget.cellSize;
        if (dist > d.radius) continue;
        const falloff = Math.exp(-(dist * dist) / Math.max(d.radius * d.radius, 0.01));
        const idx = gz * grid.width + gx;
        grid.addSurface(idx, d.amplitude * falloff);
      }
    }
  }
}

function uploadHeightTexture(
  grid: SweSim,
  texture: THREE.DataTexture,
  originX: number,
  originZ: number,
  budget: SWEBudget,
): void {
  (texture.image.data as unknown as Float32Array).set(grid.h);
  texture.needsUpdate = true;
  updateSWEHeightFieldSnapshot({
    texture,
    originX,
    originZ,
    cellSize: budget.cellSize,
    width: budget.width,
    height: budget.height,
    displacementScale: budget.displacementScale,
    enabled: true,
  });
}

interface BedState {
  valid: boolean;
  revision: number;
  originX: number;
  originZ: number;
}

/**
 * Re-rasterize the canyon floor into `grid.b` when the sampling window has
 * moved a whole cell or the treadmill has swapped segments. Every cell is
 * rewritten, so a recycled slot cannot leak its predecessor's bed.
 */
function refreshBed(
  grid: SweSim,
  originX: number,
  originZ: number,
  budget: SWEBudget,
  state: BedState,
): void {
  const revision = getBathymetryRevision();
  const moved =
    Math.abs(originX - state.originX) >= budget.cellSize ||
    Math.abs(originZ - state.originZ) >= budget.cellSize;
  if (state.valid && revision === state.revision && !moved) return;

  const covered = sampleBathymetryInto(
    grid.b,
    originX,
    originZ,
    budget.cellSize,
    grid.width,
    grid.height,
  );
  grid.commitBed();

  state.valid = true;
  state.revision = revision;
  state.originX = originX;
  state.originZ = originZ;

  publishSWEBedSnapshot({
    bed: grid.b,
    width: grid.width,
    height: grid.height,
    cellSize: budget.cellSize,
    originX,
    originZ,
    coveredCells: covered,
    sourceCount: getRegisteredBathymetryCount(),
  });
}

export function WaterForceSystem({
  vehicleRef,
  vehicleType = 'runner',
  flowSpeed = 1.2,
  waterLevel = WATER_LEVEL,
  turbulenceStrength = 0.1,
  turbulenceFrequency = 2.4,
}: WaterForceSystemProps) {
  const wasmRef = useRef<WatershedNativeModule | null>(null);
  const gridRef = useRef<SweSim | null>(null);
  const uploadedVersionRef = useRef(-1);
  const textureRef = useRef<THREE.DataTexture | null>(null);
  const originRef = useRef({ x: 0, z: 0 });
  const statusRef = useRef<'loading' | 'ready' | 'fallback'>('loading');
  const stepAccumulatorRef = useRef(0);
  // Bed refresh bookkeeping: the sampled bathymetry only needs re-rasterizing
  // when the window slides a whole cell or the treadmill changes segments.
  const bedStateRef = useRef({ valid: false, revision: -1, originX: 0, originZ: 0 });
  const [wasmReady, setWasmReady] = useState(false);

  // Visual SWE budget follows the live quality preset (LODManager may downgrade
  // it adaptively). Force math below is NOT gated — it is gameplay-affecting.
  const quality = useQualityPreset();
  const budget = useMemo(() => sweBudgetForQuality(quality), [quality]);

  useEffect(() => {
    setWaterForceSystemActive(true);

    let cancelled = false;
    getWasm()
      .then((wasm) => {
        if (cancelled) return;
        wasmRef.current = wasm;
        statusRef.current = 'ready';
        bindChoreWasm(wasm);
        setWasmReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        statusRef.current = 'fallback';
        console.error('[WaterForceSystem] native init failed; using TypeScript fallbacks', error);
        bindChoreWasm(null);
        updateSWEHeightFieldSnapshot({ enabled: false, texture: null });
        setSWEStatus(false, null);
      });

    return () => {
      cancelled = true;
      setWaterForceSystemActive(false);
      registerVehicleWaterBody(null);
      clearSWEHeightField();
      clearSWEBedSnapshot();
      setSWEStatus(false, null);
    };
  }, []);

  // Grid + upload texture are sized by the budget, so a quality change
  // reallocates both. `low` allocates nothing at all. The solver backend was
  // fixed for the session at first use (sweBackend.ts): C++ WASM, or its WGSL
  // twin on a native-WebGPU boot — never both.
  useEffect(() => {
    setSWEActiveBudget(budget);

    const wasm = wasmRef.current;
    const decision = resolveSweSimBackendDecision();
    const device = decision.backend === 'wgsl' ? getSessionGpuDevice() : null;
    if (!budget.enabled || (!device && !wasm)) {
      updateSWEHeightFieldSnapshot({ enabled: false, texture: null });
      setSWEStatus(false, null);
      return;
    }

    let cancelled = false;
    let sim: SweSim | null = null;
    const texture = new THREE.DataTexture(
      new Float32Array(budget.width * budget.height),
      budget.width,
      budget.height,
      THREE.RedFormat,
      THREE.FloatType,
    );
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    const install = (next: SweSim) => {
      sim = next;
      gridRef.current = next;
      textureRef.current = texture;
      stepAccumulatorRef.current = 0;
      uploadedVersionRef.current = -1;
      bedStateRef.current = { valid: false, revision: -1, originX: 0, originZ: 0 };
      setSWEStatus(true, `${budget.width}x${budget.height} ${next.backend}`);
      console.info(
        `[SWE] backend=${next.backend} (${resolveSweSimBackendDecision().reason}) grid=${budget.width}x${budget.height}`,
      );
    };

    if (device) {
      createWgslSweSim(device, budget.width, budget.height, budget.cellSize)
        .then((next) => {
          if (cancelled) {
            next.dispose();
            return;
          }
          install(next);
        })
        .catch((error) => {
          if (cancelled) return;
          // Nothing has stepped yet, so falling back keeps "one backend per
          // session" — the WGSL field never existed.
          console.error('[WaterForceSystem] WGSL SWE init failed; using the WASM stepper', error);
          demoteSweSimBackendToWasm();
          const fallbackWasm = wasmRef.current;
          if (fallbackWasm) install(createWasmSweSim(fallbackWasm, budget.width, budget.height, budget.cellSize));
        });
    } else if (wasm) {
      install(createWasmSweSim(wasm, budget.width, budget.height, budget.cellSize));
    }

    return () => {
      cancelled = true;
      sim?.dispose();
      gridRef.current = null;
      texture.dispose();
      textureRef.current = null;
      bedStateRef.current.valid = false;
      clearSWEBedSnapshot();
      updateSWEHeightFieldSnapshot({ enabled: false, texture: null });
      setSWEStatus(false, null);
    };
  }, [budget, wasmReady]);

  useFrame((state, delta) => {
    const vehicleBody = vehicleRef.current;
    if (vehicleBody?.applyImpulse) {
      registerVehicleWaterBody({
        translation: () => vehicleBody.translation(),
        linvel: () => vehicleBody.linvel(),
        applyImpulse: (impulse, wake) => vehicleBody.applyImpulse!(impulse, wake),
      });
    }

    const bodies = collectWaterForceBodies();
    if (bodies.length === 0) return;

    const dt = Math.min(delta, 0.05);
    const timeSeconds = state.clock.elapsedTime;
    const workerOwnsVehicleForces = isPhysicsWorkerActive();
    const anchor = vehicleBody?.translation?.() ?? bodies[0].translation();
    const originX = anchor.x - (budget.width * budget.cellSize) * 0.5;
    const originZ = anchor.z - (budget.height * budget.cellSize) * 0.5;
    originRef.current = { x: originX, z: originZ };

    const grid = gridRef.current;
    const texture = textureRef.current;
    if (budget.enabled && grid && texture) {
      // Step-rate budget: accumulate render deltas and take one SWE step per
      // budgeted interval, so a 30Hz preset costs half a 60Hz preset's steps.
      refreshBed(grid, originX, originZ, budget, bedStateRef.current);

      const interval = sweStepInterval(budget);
      stepAccumulatorRef.current += dt;
      if (stepAccumulatorRef.current >= interval) {
        const stepDt = Math.min(stepAccumulatorRef.current, 0.05);
        stepAccumulatorRef.current = 0;

        applyDisturbances(grid, originX, originZ, consumeSWEDisturbances(), budget);

        // Authored hydro events run after the step, through the same backend.
        const hydroEvents = parseHydroEvents(getActiveMap().levelData.hydroEvents);
        const eventCalls: SweEventCall[] = [];
        applyHydroEventsToGrid(
          {
            h: grid.h,
            u: grid.u,
            w: grid.w,
            b: grid.b,
            width: grid.width,
            height: grid.height,
            cellSize: grid.dx,
            originX,
            originZ,
            stillDepth: SWE_MEAN_DEPTH,
          },
          hydroEvents,
          getActiveLaunchHour(),
          (event) => {
            const source = getRegisteredBathymetrySource(event.segmentIndex);
            if (!source) return null;
            return { x: source.centerX, z: source.centerZ };
          },
          stepDt,
          (kind, cx, cz, radius, strength, dtEvent) => {
            eventCalls.push({ kind, cx, cz, radius, strength, dt: dtEvent });
          },
        );

        // Bed sampled from the canyon floor by refreshBed() above (#374
        // Phase 2). Uncovered cells read as dry land, not open water.
        grid.step({
          dt: stepDt,
          g: 9.80665,
          H: SWE_MEAN_DEPTH,
          originX,
          originZ,
          events: eventCalls,
        });
      }
      // WASM bumps fieldVersion inside step(); WGSL when its readback lands.
      if (grid.fieldVersion !== uploadedVersionRef.current) {
        uploadedVersionRef.current = grid.fieldVersion;
        uploadHeightTexture(grid, texture, originX, originZ, budget);
        runHeightfieldChores(grid.h, grid.width, grid.height);
      } else {
        // Grid didn't step, but the player moved — keep the sampling window
        // anchored so the displacement doesn't lag behind the camera.
        updateSWEHeightFieldSnapshot({ originX, originZ });
      }
    }

    const sweEnabled = Boolean(budget.enabled && grid);
    const flowGrid = grid ? toFlowGrid(grid, originX, originZ) : null;
    const vehicleFlow = sampleSWEFlow({
      worldX: anchor.x,
      worldZ: anchor.z,
      flowSpeed,
      grid: flowGrid,
      enabled: sweEnabled,
      stageSpeedBoost: SWE_STAGE_SPEED_BOOST,
    });
    setPhysicsWorkerTickParams({
      flowSpeed: vehicleFlow.speed,
      waterLevel: stagedWaterLevel(waterLevel, vehicleFlow),
      turbulenceStrength,
      turbulenceFrequency,
      flowDirX: vehicleFlow.dirX,
      flowDirZ: vehicleFlow.dirZ,
    });

    for (let i = 0; i < bodies.length; i += 1) {
      const body = bodies[i];
      try {
        const pos = body.translation();
        const vel = body.linvel();
        if (!pos || !vel) continue;

        const isVehicle = i === 0 && vehicleBody != null;
        if (shouldSkipMainThreadVehicleForce(isVehicle, workerOwnsVehicleForces)) {
          continue;
        }
        const flow = isVehicle
          ? vehicleFlow
          : sampleSWEFlow({
              worldX: pos.x,
              worldZ: pos.z,
              flowSpeed,
              grid: flowGrid,
              enabled: sweEnabled,
              stageSpeedBoost: SWE_STAGE_SPEED_BOOST,
            });
        // Buoyancy reads the *local* surface, so an authored inflowPulse
        // floats the hull higher instead of only moving the mesh (#397).
        const localWaterLevel = stagedWaterLevel(waterLevel, flow);
        const config = isVehicle
          ? vehicleForceConfig(
              vehicleType,
              flow.speed,
              localWaterLevel,
              timeSeconds,
              turbulenceStrength,
              turbulenceFrequency,
            )
          : floatingForceConfig(
              flow.speed,
              localWaterLevel,
              timeSeconds,
              body,
              turbulenceStrength * 0.8,
              turbulenceFrequency,
            );

        const force = wasmRef.current
          ? wasmRef.current.calculateWaterForce(
              pos.x, pos.y, pos.z,
              vel.x, vel.y, vel.z,
              flow.dirX, flow.dirZ,
              config.flowSpeed,
              config.waterLevel,
              config.raftMass,
              config.raftVolume,
              config.dragCoefficient,
              config.frontalArea,
              config.sideArea,
              config.timeSeconds,
              config.turbulenceStrength,
              config.turbulenceFrequency,
            )
          : calculateWaterForceFallback(
              {
                position: pos,
                velocity: vel,
                flowDirection: { x: flow.dirX, z: flow.dirZ },
              },
              config,
            );

        body.applyImpulse(
          {
            x: force.forceX * dt * PHYSICS_SCALE,
            y: force.forceY * dt * PHYSICS_SCALE,
            z: force.forceZ * dt * PHYSICS_SCALE,
          },
          true,
        );
      } catch {
        // skip unstable body this frame
      }
    }

    if (typeof window !== 'undefined') {
      (window as any).__watershedWaterForceSystem = {
        status: statusRef.current,
        origin: originRef.current,
        sampleCount: bodies.length,
        sweBudget: budget,
        workerOwnsVehicleForces,
        sampledDir: [vehicleFlow.dirX, vehicleFlow.dirZ],
        sampledSpeed: vehicleFlow.speed,
        stage: vehicleFlow.surfaceOffset,
        stagedWaterLevel: stagedWaterLevel(waterLevel, vehicleFlow),
        fallbackDir: [FALLBACK_FLOW_DIR.x, FALLBACK_FLOW_DIR.z],
        source: vehicleFlow.source,
        wet: vehicleFlow.wet,
        workerDiagnostics: workerOwnsVehicleForces
          ? (window as any).__watershedPhysicsWorker?.waterForce
          : undefined,
      };
    }
  });

  return null;
}

export default WaterForceSystem;
