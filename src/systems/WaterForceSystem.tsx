/**
 * WaterForceSystem — production WASM water coupling.
 *
 * - Steps a player-centered SWE grid and uploads height data for FlowingWater.
 * - Applies native buoyancy + current drag to the vehicle and floating debris.
 * - Falls back to pure TypeScript force math when WASM is unavailable.
 */

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { WATER_LEVEL } from '../constants/game';
import { FLOATING_OBJECT } from '../constants/game';
import { WATER_PHYSICS } from '../vehicles/RaftVehicle/constants';
import {
  calculateWaterForceFallback,
  createSWEGrid,
  getWasm,
  type NativeWaterForceConfig,
  type SWEGrid,
  type WatershedNativeModule,
} from './WatershedWasm';
import {
  SWE_CELL_SIZE,
  SWE_GRID_HEIGHT,
  SWE_GRID_WIDTH,
  SWE_MEAN_DEPTH,
  consumeSWEDisturbances,
  updateSWEHeightFieldSnapshot,
  clearSWEHeightField,
} from './SWEHeightField';
import {
  collectWaterForceBodies,
  registerVehicleWaterBody,
  setWaterForceSystemActive,
  type WaterForceBody,
} from './WaterForceRegistry';
import type { VehicleRigidBodyRef, VehicleType } from '../experience/types';

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
): { gx: number; gz: number } | null {
  const gx = Math.round((worldX - originX) / SWE_CELL_SIZE);
  const gz = Math.round((worldZ - originZ) / SWE_CELL_SIZE);
  if (gx < 0 || gx >= SWE_GRID_WIDTH || gz < 0 || gz >= SWE_GRID_HEIGHT) return null;
  return { gx, gz };
}

function applyDisturbances(
  grid: SWEGrid,
  originX: number,
  originZ: number,
  disturbances: ReturnType<typeof consumeSWEDisturbances>,
): void {
  for (const d of disturbances) {
    const center = worldToGridIndex(d.worldX, d.worldZ, originX, originZ);
    if (!center) continue;

    const radiusCells = Math.max(1, Math.ceil(d.radius / SWE_CELL_SIZE));
    for (let dz = -radiusCells; dz <= radiusCells; dz += 1) {
      for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
        const gx = center.gx + dx;
        const gz = center.gz + dz;
        if (gx < 0 || gx >= grid.width || gz < 0 || gz >= grid.height) continue;
        const dist = Math.hypot(dx, dz) * SWE_CELL_SIZE;
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
): void {
  texture.image.data.set(grid.h);
  texture.needsUpdate = true;
  updateSWEHeightFieldSnapshot({
    texture,
    originX,
    originZ,
    cellSize: SWE_CELL_SIZE,
    width: SWE_GRID_WIDTH,
    height: SWE_GRID_HEIGHT,
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
  const gridInitializedRef = useRef(false);

  useEffect(() => {
    setWaterForceSystemActive(true);

    let cancelled = false;
    getWasm()
      .then((wasm) => {
        if (cancelled) return;
        wasmRef.current = wasm;
        statusRef.current = 'ready';
        gridRef.current = createSWEGrid(wasm, SWE_GRID_WIDTH, SWE_GRID_HEIGHT, SWE_CELL_SIZE);
        gridRef.current.h.fill(SWE_MEAN_DEPTH);
      })
      .catch((error) => {
        if (cancelled) return;
        statusRef.current = 'fallback';
        console.warn('[WaterForceSystem] WASM unavailable; using TypeScript fallbacks', error);
        updateSWEHeightFieldSnapshot({ enabled: false, texture: null });
      });

    const texture = new THREE.DataTexture(
      new Float32Array(SWE_GRID_WIDTH * SWE_GRID_HEIGHT),
      SWE_GRID_WIDTH,
      SWE_GRID_HEIGHT,
      THREE.RedFormat,
      THREE.FloatType,
    );
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    textureRef.current = texture;

    return () => {
      cancelled = true;
      setWaterForceSystemActive(false);
      registerVehicleWaterBody(null);
      gridRef.current?.dispose();
      gridRef.current = null;
      texture.dispose();
      textureRef.current = null;
      clearSWEHeightField();
    };
  }, []);

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
    const anchor = vehicleBody?.translation?.() ?? bodies[0].translation();
    const originX = anchor.x - (SWE_GRID_WIDTH * SWE_CELL_SIZE) * 0.5;
    const originZ = anchor.z - (SWE_GRID_HEIGHT * SWE_CELL_SIZE) * 0.5;
    originRef.current = { x: originX, z: originZ };

    const grid = gridRef.current;
    const texture = textureRef.current;
    if (grid && texture && wasmRef.current) {
      if (!gridInitializedRef.current) {
        grid.h.fill(SWE_MEAN_DEPTH);
        gridInitializedRef.current = true;
      }

      applyDisturbances(grid, originX, originZ, consumeSWEDisturbances());

      wasmRef.current.stepShallowWater(
        grid.hPtr,
        grid.uPtr,
        grid.wPtr,
        grid.width,
        grid.height,
        dt,
        9.80665,
        grid.dx,
        SWE_MEAN_DEPTH,
      );

      uploadHeightTexture(grid, texture, originX, originZ);
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
      };
    }
  });

  return null;
}

export default WaterForceSystem;
