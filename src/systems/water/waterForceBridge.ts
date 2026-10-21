/**
 * waterForceBridge — the force half of WaterForceSystem (#467 split).
 *
 * Buoyancy + current drag on the vehicle and floating debris, from the flow
 * the SWE field carries at each body (sampleSWEFlow → calculateWaterForce).
 * Two paths, chosen per frame by waterForceAuthority.ts:
 *
 * - 'sim-worker': forces.cpp runs in the sim worker on the field it steps
 *   (simForces.ts). This frame's bodies are posted; the results land a frame
 *   later and are applied with the dt of the frame that sampled them. The
 *   Rapier worker's raft takes its force over the hull link instead
 *   (hullLinkProtocol.ts), so only the authored tick params go to it.
 * - 'ts-mirror': calculateWaterForceFallback on this thread, sampling the
 *   field's CPU mirror — `?simWorker=0`, a native-WebGPU boot, or a sim worker
 *   that died (SWE is off then). A Rapier-worker raft gets the same mirror from
 *   RaftVehicle, sent with its step (hullMirrorForce.ts).
 *
 * Water level: a body's still level is the sheet over it — the covering
 * segment's path y plus the authored offset (`waterLevel`, WATER_LEVEL), from
 * `sampleWaterSheetY`. The river descends hundreds of metres over a map, so an
 * absolute level put every body below the surface (a runner on the floor was
 * fully submerged, dragged to a crawl). A body over no segment feels no water.
 *
 * The field half is sweHost.ts.
 */

import { FLOATING_OBJECT } from '../../constants/game';
import { WATER_PHYSICS } from '../../vehicles/RaftVehicle/constants';
import type { NativeWaterForceConfig } from './wasmAbi';
import { calculateWaterForceFallback } from './waterForceFallback';
import type { SweSim } from './sweSim';
import type { SimWorkerProxy } from '../../sim/createSimWorkerProxy';
import { isWorkerSweSim } from '../../sim/workerSweSim';
import {
  FORCE_SAMPLE_STRIDE,
  readForceFlow,
  readForceResult,
  writeForceSample,
} from '../../sim/simForces';
import type { SimForceRequests } from '../../sim/simForceRequests';
import type { WaterForceBody } from './WaterForceRegistry';
import { getPhysicsWorkerDiagnostics, setPhysicsWorkerTickParams } from '../../physics/physicsWorkerRegistry';
import {
  sampleSWEFlow,
  FALLBACK_FLOW_DIR,
  SWE_STAGE_SPEED_BOOST,
  stagedWaterLevel,
  type SWEFlowSample,
} from './sampleSWEFlow';
import { toFlowGrid } from './sweHost';
import { sampleWaterSheetY } from './bathymetrySampler';
import { resolveWaterForceOwner, WATER_FORCE_IMPULSE_SCALE, type WaterForceOwner } from '../../physics/waterForceAuthority';
import type { VehicleType } from '../../experience/types';

export function vehicleForceConfig(
  vehicleType: VehicleType,
  flowSpeed: number,
  waterLevel: number,
  timeSeconds: number,
  turbulenceStrength: number,
  turbulenceFrequency: number,
  dragScale = 1,
): NativeWaterForceConfig {
  if (vehicleType === 'raft') {
    return {
      flowSpeed,
      waterLevel,
      raftMass: WATER_PHYSICS.RAFT_MASS,
      raftVolume: WATER_PHYSICS.RAFT_VOLUME,
      dragCoefficient: WATER_PHYSICS.DRAG_COEFFICIENT * dragScale,
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
    dragCoefficient: dragScale,
    frontalArea: 0.45,
    sideArea: 0.35,
    timeSeconds,
    turbulenceStrength: turbulenceStrength * 0.75,
    turbulenceFrequency,
  };
}

export function floatingForceConfig(
  flowSpeed: number,
  waterLevel: number,
  timeSeconds: number,
  body: WaterForceBody,
  turbulenceStrength: number,
  turbulenceFrequency: number,
  dragScale = 1,
): NativeWaterForceConfig {
  return {
    flowSpeed: flowSpeed * FLOATING_OBJECT.FLOW_INFLUENCE,
    waterLevel,
    raftMass: (body.mass ?? FLOATING_OBJECT.DEBRIS_DENSITY * FLOATING_OBJECT.DEBRIS_VOLUME) * WATER_FORCE_IMPULSE_SCALE,
    raftVolume: body.volume ?? FLOATING_OBJECT.DEBRIS_VOLUME,
    dragCoefficient: (body.dragCoefficient ?? FLOATING_OBJECT.DRAG_COEFFICIENT) * dragScale,
    frontalArea: body.frontalArea ?? FLOATING_OBJECT.DRAG_AREA,
    sideArea: body.sideArea ?? FLOATING_OBJECT.DRAG_AREA * 0.6,
    timeSeconds,
    turbulenceStrength,
    turbulenceFrequency,
  };
}

/** What a force sample is applied to when its result lands: the vehicle (by its rigid body) or a debris body. */
export type ForceTarget = { vehicle: object } | { body: WaterForceBody };

/**
 * Apply force results that landed from the sim worker since the last frame,
 * with the dt of the frame that sampled them, to bodies still registered. The
 * vehicle takes its result only while this thread (not the Rapier worker) owns
 * its force — the one-owner rule of waterForceAuthority.ts, checked at apply.
 */
function applyWorkerForces(
  requests: SimForceRequests<ForceTarget>,
  bodies: readonly WaterForceBody[],
  vehicleBody: object | null,
  workerOwnsVehicleForces: boolean,
  vehicleFlowRef: { current: SWEFlowSample | null },
): void {
  const landed = requests.drain();
  if (landed.length === 0) return;
  const registered = new Set(bodies);
  for (const batch of landed) {
    for (let i = 0; i < batch.count; i += 1) {
      const target = batch.targets[i];
      let body: WaterForceBody | null = null;
      if ('vehicle' in target) {
        if (workerOwnsVehicleForces || target.vehicle !== vehicleBody) continue;
        body = bodies[0] ?? null;
        vehicleFlowRef.current = readForceFlow(batch.results, i);
      } else if (registered.has(target.body)) {
        body = target.body;
      }
      if (!body) continue;
      const force = readForceResult(batch.results, i);
      try {
        body.applyImpulse(
          {
            x: force.forceX * batch.dt * WATER_FORCE_IMPULSE_SCALE,
            y: force.forceY * batch.dt * WATER_FORCE_IMPULSE_SCALE,
            z: force.forceZ * batch.dt * WATER_FORCE_IMPULSE_SCALE,
          },
          true,
        );
      } catch {
        // skip unstable body this frame
      }
    }
    requests.release(batch.results);
  }
}

interface WorkerForceFrame {
  bodies: readonly WaterForceBody[];
  vehicleBody: object | null;
  vehicleType: VehicleType;
  workerOwnsVehicleForces: boolean;
  gridId: number;
  originX: number;
  originZ: number;
  dt: number;
  timeSeconds: number;
  flowSpeed: number;
  waterLevel: number;
  turbulenceStrength: number;
  turbulenceFrequency: number;
  dragScale: number;
}

/**
 * Pack this frame's bodies for the sim worker (simForces.ts wire format): the
 * same configs the main-thread loop builds, with the AUTHORED flow speed and
 * water level — the worker samples and stages them on the stepped field.
 */
function postWorkerForces(requests: SimForceRequests<ForceTarget>, frame: WorkerForceFrame): void {
  const { bodies, vehicleBody } = frame;
  const samples = requests.acquire(bodies.length);
  const targets: ForceTarget[] = [];
  for (let i = 0; i < bodies.length && (targets.length + 1) * FORCE_SAMPLE_STRIDE <= samples.length; i += 1) {
    const body = bodies[i];
    try {
      const pos = body.translation();
      const vel = body.linvel();
      if (!pos || !vel) continue;
      const isVehicle = i === 0 && vehicleBody != null;
      // A Rapier-worker raft takes its force over the hull link instead.
      if (isVehicle && frame.workerOwnsVehicleForces) continue;
      const sheet = sampleWaterSheetY(pos.x, pos.z, frame.waterLevel);
      if (sheet === null) continue;
      const config = isVehicle
        ? vehicleForceConfig(
            frame.vehicleType,
            frame.flowSpeed,
            sheet,
            frame.timeSeconds,
            frame.turbulenceStrength,
            frame.turbulenceFrequency,
            frame.dragScale,
          )
        : floatingForceConfig(
            frame.flowSpeed,
            sheet,
            frame.timeSeconds,
            body,
            frame.turbulenceStrength * 0.8,
            frame.turbulenceFrequency,
            frame.dragScale,
          );
      writeForceSample(
        samples,
        targets.length,
        { position: pos, velocity: vel },
        config,
        frame.flowSpeed,
        isVehicle ? 1 : FLOATING_OBJECT.FLOW_INFLUENCE,
      );
      targets.push(isVehicle ? { vehicle: vehicleBody } : { body });
    } catch {
      // skip unstable body this frame
    }
  }
  if (targets.length === 0) {
    requests.release(samples);
    return;
  }
  requests.send(frame.gridId, frame.originX, frame.originZ, samples, targets, frame.dt);
}

/** One frame's inputs to the force half. */
export interface WaterForceFrame {
  bodies: readonly WaterForceBody[];
  vehicleBody: object | null;
  vehicleType: VehicleType;
  /** The Rapier worker owns the vehicle body (its force arrives over the hull link or with its step). */
  workerOwnsVehicleForces: boolean;
  anchor: { x: number; z: number };
  grid: SweSim | null;
  originX: number;
  originZ: number;
  sweEnabled: boolean;
  dt: number;
  timeSeconds: number;
  /** Authored flow cap, already scaled by the weather (#464). */
  flowSpeed: number;
  waterLevel: number;
  turbulenceStrength: number;
  turbulenceFrequency: number;
  dragScale: number;
  /** The sim worker's force channel, or null when it is not up (or died). */
  simProxy: SimWorkerProxy | null;
  requests: SimForceRequests<ForceTarget> | null;
  /** The vehicle's flow as the sim worker last sampled it (debug). */
  vehicleFlowRef: { current: SWEFlowSample | null };
}

/**
 * Apply this frame's water forces on whichever of the two paths owns them,
 * and publish the tick params the Rapier worker reads. Returns the owner and
 * the vehicle's flow for the debug readout.
 */
export function applyWaterForces(frame: WaterForceFrame): {
  owner: WaterForceOwner;
  vehicleFlow: SWEFlowSample;
} {
  const { bodies, vehicleBody, workerOwnsVehicleForces, anchor, grid, originX, originZ } = frame;
  const requests = frame.simProxy && !frame.simProxy.failed ? frame.requests : null;
  const owner = resolveWaterForceOwner({ simWorkerForces: requests !== null });

  if (requests) {
    applyWorkerForces(requests, bodies, vehicleBody, workerOwnsVehicleForces, frame.vehicleFlowRef);
    // The Rapier worker samples the sim worker itself (hull link): authored values only.
    setPhysicsWorkerTickParams({
      flowSpeed: frame.flowSpeed,
      waterLevel: frame.waterLevel,
      turbulenceStrength: frame.turbulenceStrength,
      turbulenceFrequency: frame.turbulenceFrequency,
      flowDirX: FALLBACK_FLOW_DIR.x,
      flowDirZ: FALLBACK_FLOW_DIR.z,
      simFlow: true,
    });
    postWorkerForces(requests, {
      bodies,
      vehicleBody,
      vehicleType: frame.vehicleType,
      workerOwnsVehicleForces,
      gridId: isWorkerSweSim(grid) ? grid.gridId : -1,
      originX,
      originZ,
      dt: frame.dt,
      timeSeconds: frame.timeSeconds,
      flowSpeed: frame.flowSpeed,
      waterLevel: frame.waterLevel,
      turbulenceStrength: frame.turbulenceStrength,
      turbulenceFrequency: frame.turbulenceFrequency,
      dragScale: frame.dragScale,
    });
    const vehicleFlow =
      (workerOwnsVehicleForces ? getPhysicsWorkerDiagnostics()?.sampledFlow : frame.vehicleFlowRef.current) ??
      sampleSWEFlow({ worldX: anchor.x, worldZ: anchor.z, flowSpeed: frame.flowSpeed, grid: null, enabled: false });
    return { owner, vehicleFlow };
  }

  // TS mirror on this thread, over the field's CPU mirror. This thread's
  // module, when it has one, only steps the field.
  const flowGrid = grid ? toFlowGrid(grid, originX, originZ) : null;
  const vehicleFlow = sampleSWEFlow({
    worldX: anchor.x,
    worldZ: anchor.z,
    flowSpeed: frame.flowSpeed,
    grid: flowGrid,
    enabled: frame.sweEnabled,
    stageSpeedBoost: SWE_STAGE_SPEED_BOOST,
  });
  setPhysicsWorkerTickParams({
    flowSpeed: vehicleFlow.speed,
    waterLevel: stagedWaterLevel(frame.waterLevel, vehicleFlow),
    turbulenceStrength: frame.turbulenceStrength,
    turbulenceFrequency: frame.turbulenceFrequency,
    flowDirX: vehicleFlow.dirX,
    flowDirZ: vehicleFlow.dirZ,
    simFlow: false,
  });

  for (let i = 0; i < bodies.length; i += 1) {
    const body = bodies[i];
    try {
      const pos = body.translation();
      const vel = body.linvel();
      if (!pos || !vel) continue;

      const isVehicle = i === 0 && vehicleBody != null;
      // A Rapier-worker raft gets this same mirror from RaftVehicle, which
      // sends it with the step (hullMirrorForce.ts).
      if (isVehicle && workerOwnsVehicleForces) continue;
      const sheet = sampleWaterSheetY(pos.x, pos.z, frame.waterLevel);
      if (sheet === null) continue;
      const flow = isVehicle
        ? vehicleFlow
        : sampleSWEFlow({
            worldX: pos.x,
            worldZ: pos.z,
            flowSpeed: frame.flowSpeed,
            grid: flowGrid,
            enabled: frame.sweEnabled,
            stageSpeedBoost: SWE_STAGE_SPEED_BOOST,
          });
      // Buoyancy reads the *local* surface, so an authored inflowPulse
      // floats the hull higher instead of only moving the mesh (#397).
      const localWaterLevel = stagedWaterLevel(sheet, flow);
      const config = isVehicle
        ? vehicleForceConfig(
            frame.vehicleType,
            flow.speed,
            localWaterLevel,
            frame.timeSeconds,
            frame.turbulenceStrength,
            frame.turbulenceFrequency,
            frame.dragScale,
          )
        : floatingForceConfig(
            flow.speed,
            localWaterLevel,
            frame.timeSeconds,
            body,
            frame.turbulenceStrength * 0.8,
            frame.turbulenceFrequency,
            frame.dragScale,
          );

      const force = calculateWaterForceFallback(
        {
          position: pos,
          velocity: vel,
          flowDirection: { x: flow.dirX, z: flow.dirZ },
        },
        config,
      );

      body.applyImpulse(
        {
          x: force.forceX * frame.dt * WATER_FORCE_IMPULSE_SCALE,
          y: force.forceY * frame.dt * WATER_FORCE_IMPULSE_SCALE,
          z: force.forceZ * frame.dt * WATER_FORCE_IMPULSE_SCALE,
        },
        true,
      );
    } catch {
      // skip unstable body this frame
    }
  }
  return { owner, vehicleFlow };
}
