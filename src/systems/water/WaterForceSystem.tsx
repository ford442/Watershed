/**
 * WaterForceSystem — production WASM water coupling.
 *
 * - Steps a player-centered SWE grid and uploads height data for FlowingWater.
 * - Applies native buoyancy + current drag to the vehicle and floating debris.
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
  createSWEGrid,
  getWasm,
  type NativeWaterForceConfig,
  type SWEGrid,
  type WatershedNativeModule,
} from './WatershedWasm';
import {
  SWE_MEAN_DEPTH,
  consumeSWEDisturbances,
  setSWEActiveBudget,
  updateSWEHeightFieldSnapshot,
  clearSWEHeightField,
} from './SWEHeightField';
import { sweBudgetForQuality, sweStepInterval, type SWEBudget } from './sweQuality';
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

function applyDisturbances(
  grid: SWEGrid,
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
        grid.h[idx] += d.amplitude * falloff;
      }
    }
  }
}

function uploadHeightTexture(
  grid: SWEGrid,
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

export function WaterForceSystem({
  vehicleRef,
  vehicleType = 'runner',
  flowSpeed = 1.2,
  waterLevel = WATER_LEVEL,
  turbulenceStrength = 0.1,
  turbulenceFrequency = 2.4,
}: WaterForceSystemProps) {
  const wasmRef = useRef<WatershedNativeModule | null>(null);
  const gridRef = useRef<SWEGrid | null>(null);
  const textureRef = useRef<THREE.DataTexture | null>(null);
  const originRef = useRef({ x: 0, z: 0 });
  const statusRef = useRef<'loading' | 'ready' | 'fallback'>('loading');
  const stepAccumulatorRef = useRef(0);
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
        console.warn('[WaterForceSystem] WASM unavailable; using TypeScript fallbacks', error);
        bindChoreWasm(null);
        updateSWEHeightFieldSnapshot({ enabled: false, texture: null });
        setSWEStatus(false, null);
      });

    return () => {
      cancelled = true;
      setWaterForceSystemActive(false);
      registerVehicleWaterBody(null);
      clearSWEHeightField();
      setSWEStatus(false, null);
    };
  }, []);

  // Grid + upload texture are sized by the budget, so a quality change
  // reallocates both. `low` allocates nothing at all.
  useEffect(() => {
    setSWEActiveBudget(budget);

    const wasm = wasmRef.current;
    if (!budget.enabled || !wasm) {
      updateSWEHeightFieldSnapshot({ enabled: false, texture: null });
      setSWEStatus(false, null);
      return;
    }

    const grid = createSWEGrid(wasm, budget.width, budget.height, budget.cellSize);
    grid.h.fill(SWE_MEAN_DEPTH);
    gridRef.current = grid;

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
    textureRef.current = texture;
    stepAccumulatorRef.current = 0;
    setSWEStatus(true, `${budget.width}x${budget.height}`);

    return () => {
      grid.dispose();
      gridRef.current = null;
      texture.dispose();
      textureRef.current = null;
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
    setPhysicsWorkerTickParams({
      flowSpeed,
      waterLevel,
      turbulenceStrength,
      turbulenceFrequency,
      flowDirX: 0,
      flowDirZ: -1,
    });
    const anchor = vehicleBody?.translation?.() ?? bodies[0].translation();
    const originX = anchor.x - (budget.width * budget.cellSize) * 0.5;
    const originZ = anchor.z - (budget.height * budget.cellSize) * 0.5;
    originRef.current = { x: originX, z: originZ };

    const grid = gridRef.current;
    const texture = textureRef.current;
    if (budget.enabled && grid && texture && wasmRef.current) {
      // Step-rate budget: accumulate render deltas and take one SWE step per
      // budgeted interval, so a 30Hz preset costs half a 60Hz preset's steps.
      const interval = sweStepInterval(budget);
      stepAccumulatorRef.current += dt;
      if (stepAccumulatorRef.current >= interval) {
        const stepDt = Math.min(stepAccumulatorRef.current, 0.05);
        stepAccumulatorRef.current = 0;

        applyDisturbances(grid, originX, originZ, consumeSWEDisturbances(), budget);

        wasmRef.current.stepShallowWater(
          grid.hPtr,
          grid.uPtr,
          grid.wPtr,
          grid.width,
          grid.height,
          stepDt,
          9.80665,
          grid.dx,
          SWE_MEAN_DEPTH,
        );

        uploadHeightTexture(grid, texture, originX, originZ, budget);
        runHeightfieldChores(grid.h, grid.width, grid.height);
      } else {
        // Grid didn't step, but the player moved — keep the sampling window
        // anchored so the displacement doesn't lag behind the camera.
        updateSWEHeightFieldSnapshot({ originX, originZ });
      }
    }

    const vehicleConfig = vehicleForceConfig(
      vehicleType,
      flowSpeed,
      waterLevel,
      timeSeconds,
      turbulenceStrength,
      turbulenceFrequency,
    );

    if (wasmRef.current) {
      for (let i = 0; i < bodies.length; i += 1) {
        const body = bodies[i];
        try {
          const pos = body.translation();
          const vel = body.linvel();
          if (!pos || !vel) continue;

          const isVehicle = i === 0 && vehicleBody != null;
          if (isVehicle && workerOwnsVehicleForces) {
            continue;
          }
          const config = isVehicle
            ? vehicleConfig
            : floatingForceConfig(
                flowSpeed,
                waterLevel,
                timeSeconds,
                body,
                turbulenceStrength * 0.8,
                turbulenceFrequency,
              );

          const force = wasmRef.current.calculateWaterForce(
            pos.x, pos.y, pos.z,
            vel.x, vel.y, vel.z,
            0, -1,
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
    } else {
      for (let i = 0; i < bodies.length; i += 1) {
        const body = bodies[i];
        try {
          const pos = body.translation();
          const vel = body.linvel();
          if (!pos || !vel) continue;

          const isVehicle = i === 0 && vehicleBody != null;
          if (isVehicle && workerOwnsVehicleForces) {
            continue;
          }
          const config = isVehicle
            ? vehicleConfig
            : floatingForceConfig(
                flowSpeed,
                waterLevel,
                timeSeconds,
                body,
                turbulenceStrength * 0.8,
                turbulenceFrequency,
              );

          const force = calculateWaterForceFallback(
            {
              position: pos,
              velocity: vel,
              flowDirection: { x: 0, z: -1 },
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
    }

    if (typeof window !== 'undefined' && import.meta.env.DEV) {
      (window as any).__watershedWaterForceSystem = {
        status: statusRef.current,
        origin: originRef.current,
        sampleCount: bodies.length,
        sweBudget: budget,
        workerOwnsVehicleForces,
        workerDiagnostics: workerOwnsVehicleForces
          ? (window as any).__watershedPhysicsWorker?.waterForce
          : undefined,
      };
    }
  });

  return null;
}

export default WaterForceSystem;
