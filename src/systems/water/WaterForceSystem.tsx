/**
 * WaterForceSystem — the water the hull floats in, wired into the scene.
 *
 * Two halves (#467 split), both run from this component's frame:
 *
 * - sweHost.ts — the player-centred SWE window: scroll with the world, bed
 *   refresh, routed upstream edge, stepping at the quality budget's rate, and
 *   the height / surface textures FlowingWater displaces by. The solver runs in
 *   the sim worker by default (src/sim/, #455); this file still clocks it — same
 *   dt and events on every backend — and reads the field back through the
 *   SweSim mirror.
 * - waterForceBridge.ts — buoyancy + current drag on the vehicle and debris,
 *   on one of two paths (waterForceAuthority.ts): forces.cpp in the sim worker,
 *   or the TS mirror on this thread.
 *
 * What stays here is the lifecycle: which backend this session steps on (and
 * the demotions when a worker or WGSL init fails), the grid and textures the
 * quality budget sizes, and the debug readout.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { WATER_LEVEL } from '../../constants/game';
import type { WatershedNativeModule } from './wasmAbi';
import { getWasm } from './wasmLoader';
import { createWasmSweSim, type SweSim } from './sweSim';
import {
  demoteSweSimBackendToWasm,
  demoteSweSimBackendToWasmMain,
  resolveSweSimBackendDecision,
} from './sweBackend';
import { getSimWorkerProxy, type SimWorkerProxy } from '../../sim/createSimWorkerProxy';
import { createWorkerSweSim } from '../../sim/workerSweSim';
import { createSimForceRequests, type SimForceRequests } from '../../sim/simForceRequests';
import { getSessionGpuDevice } from '../../rendering/gpuChores/device';
import { setSWEActiveBudget, updateSWEHeightFieldSnapshot, clearSWEHeightField } from './SWEHeightField';
import { sweBudgetForQuality } from './sweQuality';
import { clearSWEBedSnapshot } from './sweBedDebug';
import { useQualityPreset } from '../GameState';
import { queryFlags } from '../../config/queryFlags';
import { getActiveGameplayProfile } from '../gameplay/activeGameplayProfile';
import {
  collectWaterForceBodies,
  registerVehicleWaterBody,
  setSweReadiness,
  setWaterForceSystemActive,
} from './WaterForceRegistry';
import { isPhysicsWorkerActive, setSWEStatus } from '../../physics/physicsWorkerRegistry';
import { bindChoreWasm, bindHeightfieldChoreWorker } from '../../rendering/gpuChores';
import {
  FALLBACK_FLOW_DIR,
  MAX_STAGE_OFFSET,
  stagedWaterLevel,
  type SWEFlowSample,
} from './sampleSWEFlow';
import { SWE_FLOW_CHANNELS } from './sweSurfaceField';
import { getActiveWeather } from '../journey/runSession';
import { weatherHullScale } from '../map/weatherInflow';
import { createSweHostState, disposeSweHostRouters, resetSweHostForGrid, sweHostFrame } from './sweHost';
import { applyWaterForces, type ForceTarget } from './waterForceBridge';
import type { VehicleRigidBodyRef, VehicleType } from '../../experience/types';

interface WaterForceSystemProps {
  vehicleRef: React.RefObject<VehicleRigidBodyRef | null>;
  vehicleType?: VehicleType;
  /**
   * Flow cap override. Unset: the active gameplay profile's `flowCap` (the
   * segment under the player, blended in sim time by the SimCore
   * `gameplay-profile` system, #521 B). Never a biome palette: colour grading
   * does not push the hull.
   */
  flowSpeed?: number;
  waterLevel?: number;
  turbulenceStrength?: number;
  turbulenceFrequency?: number;
}

// Pure (sampleSWEFlow.ts) so the sim worker stages buoyancy with the same code.
export { MAX_STAGE_OFFSET, stagedWaterLevel };

export function WaterForceSystem({
  vehicleRef,
  vehicleType = 'runner',
  flowSpeed,
  waterLevel = WATER_LEVEL,
  turbulenceStrength = 0.1,
  turbulenceFrequency = 2.4,
}: WaterForceSystemProps) {
  const wasmRef = useRef<WatershedNativeModule | null>(null);
  // The field half's state (sweHost.ts): grid, textures, window, bed, routers.
  const hostRef = useRef(createSweHostState());
  const originRef = useRef({ x: 0, z: 0 });
  const statusRef = useRef<'loading' | 'ready' | 'fallback'>('loading');
  // Set once the sim worker is READY: from then on forces run there, not here.
  const simProxyRef = useRef<SimWorkerProxy | null>(null);
  const forceRequestsRef = useRef<SimForceRequests<ForceTarget> | null>(null);
  // The vehicle's flow as the sim worker last sampled it (debug only).
  const workerVehicleFlowRef = useRef<SWEFlowSample | null>(null);
  const [wasmReady, setWasmReady] = useState(false);
  const mountedRef = useRef(false);
  const [debugGlobals] = useState(() => queryFlags().debugGlobals);

  // The main-thread module — loaded only when this session's stepper is on
  // this thread (`wasm-main`: `?simWorker=0`, no Worker, a failed worker
  // handshake, or a failed WGSL init). A sim-worker boot never instantiates
  // it here, and a native-WebGPU boot does not either: one module per session.
  const loadMainWasm = useCallback(() => {
    getWasm()
      .then((wasm) => {
        if (!mountedRef.current) return;
        wasmRef.current = wasm;
        statusRef.current = 'ready';
        bindChoreWasm(wasm);
        setWasmReady(true);
      })
      .catch((error) => {
        if (!mountedRef.current) return;
        statusRef.current = 'fallback';
        setSweReadiness('off');
        console.error('[WaterForceSystem] native init failed; using TypeScript fallbacks', error);
        bindChoreWasm(null);
        updateSWEHeightFieldSnapshot({ enabled: false, texture: null });
        setSWEStatus(false, null);
      });
  }, []);

  // Visual SWE budget follows the live quality preset (LODManager may downgrade
  // it adaptively). Force math below is NOT gated — it is gameplay-affecting.
  const quality = useQualityPreset();
  const budget = useMemo(() => sweBudgetForQuality(quality), [quality]);

  useEffect(() => {
    setWaterForceSystemActive(true);
    setSweReadiness('pending');
    mountedRef.current = true;
    const host = hostRef.current;
    let cancelled = false;

    const decision = resolveSweSimBackendDecision();
    if (decision.backend === 'wasm-worker') {
      // Start the handshake now, so the grid effect below finds the worker
      // READY. Once READY it owns the water forces (Phase B) and the chores.
      getSimWorkerProxy()
        .then((proxy) => {
          if (cancelled || proxy.failed) return;
          simProxyRef.current = proxy;
          forceRequestsRef.current = createSimForceRequests<ForceTarget>(proxy);
          statusRef.current = 'ready';
        })
        .catch(() => {
          if (cancelled) return;
          // Nothing has stepped in the worker: its module never existed, so
          // the main-thread one is still this session's only module.
          demoteSweSimBackendToWasmMain();
          loadMainWasm();
        });
    } else if (decision.backend === 'wasm-main') {
      loadMainWasm();
    } else {
      // Native WebGPU: the WGSL twin steps, forces take the TS math, and the
      // C++ router is absent — the window's edge takes the rest inflow.
      statusRef.current = 'fallback';
      console.info('[WaterForceSystem] native WebGPU: no WASM module this session (TS forces, unrouted edge)');
    }

    return () => {
      cancelled = true;
      mountedRef.current = false;
      bindHeightfieldChoreWorker(null);
      disposeSweHostRouters(host);
      forceRequestsRef.current?.dispose();
      forceRequestsRef.current = null;
      simProxyRef.current = null;
      workerVehicleFlowRef.current = null;
      setWaterForceSystemActive(false);
      setSweReadiness('pending');
      registerVehicleWaterBody(null);
      clearSWEHeightField();
      clearSWEBedSnapshot();
      setSWEStatus(false, null);
    };
  }, [loadMainWasm]);

  // Grid + upload texture are sized by the budget, so a quality change
  // reallocates both. `low` allocates nothing at all. The solver backend was
  // fixed for the session at first use (sweBackend.ts): C++ WASM in the sim
  // worker (or on the main thread), or its WGSL twin on a native-WebGPU boot —
  // never two in one session.
  useEffect(() => {
    setSWEActiveBudget(budget);

    const wasm = wasmRef.current;
    const decision = resolveSweSimBackendDecision();
    const device = decision.backend === 'wgsl' ? getSessionGpuDevice() : null;
    const canStep = device !== null || wasm !== null || decision.backend === 'wasm-worker';
    if (!budget.enabled || !canStep) {
      updateSWEHeightFieldSnapshot({ enabled: false, texture: null, flowTexture: null });
      setSWEStatus(false, null);
      // No budget, or no stepper and none coming (the module failed): settled.
      // No stepper *yet* (the main module is still loading) stays pending.
      if (!budget.enabled || statusRef.current === 'fallback') setSweReadiness('off');
      return;
    }

    let cancelled = false;
    let sim: SweSim | null = null;
    let unsubscribeFatal: (() => void) | null = null;
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
    const flowTexture = new THREE.DataTexture(
      new Float32Array(budget.width * budget.height * SWE_FLOW_CHANNELS),
      budget.width,
      budget.height,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    flowTexture.minFilter = THREE.LinearFilter;
    flowTexture.magFilter = THREE.LinearFilter;
    flowTexture.wrapS = THREE.ClampToEdgeWrapping;
    flowTexture.wrapT = THREE.ClampToEdgeWrapping;

    // SWE off, as when native init fails: the analytic surface and fallback flow.
    const host = hostRef.current;
    const disableSwe = () => {
      host.grid = null;
      updateSWEHeightFieldSnapshot({ enabled: false, texture: null, flowTexture: null });
      setSWEStatus(false, null);
      setSweReadiness('off');
    };

    const install = (next: SweSim) => {
      sim = next;
      host.grid = next;
      host.texture = texture;
      host.flowTexture = flowTexture;
      resetSweHostForGrid(host);
      setSWEStatus(true, `${budget.width}x${budget.height} ${next.backend}`);
      setSweReadiness('ready');
      console.info(
        `[SWE] backend=${next.backend} (${resolveSweSimBackendDecision().reason}) grid=${budget.width}x${budget.height}`,
      );
    };

    if (device) {
      // The WGSL twin (stepper + swe.wgsl, ~46 kB pre-minify) is native-WebGPU-only, so a
      // WebGL2 boot never fetches it. Its init is already async; the import joins that wait.
      import('./WgslSweSim')
        .then(({ createWgslSweSim }) => createWgslSweSim(device, budget.width, budget.height, budget.cellSize))
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
          // The module loads only now; `wasmReady` re-runs this effect on wasm-main.
          const fallbackWasm = wasmRef.current;
          if (fallbackWasm) install(createWasmSweSim(fallbackWasm, budget.width, budget.height, budget.cellSize));
          else loadMainWasm();
        });
    } else if (decision.backend === 'wasm-worker') {
      getSimWorkerProxy()
        .then((proxy) => {
          if (cancelled) return;
          if (proxy.failed) {
            // The worker died after an earlier grid had stepped in it; a fresh
            // main-thread field would be a second backend this session.
            disableSwe();
            return;
          }
          const next = createWorkerSweSim(proxy, budget.width, budget.height, budget.cellSize);
          unsubscribeFatal = proxy.onFatal(() => {
            bindHeightfieldChoreWorker(null);
            if (host.grid === next) disableSwe();
          });
          // The debug-stat chores run on the worker's module, over its field.
          bindHeightfieldChoreWorker((thumbWidth, thumbHeight) =>
            proxy.requestChores(next.gridId, thumbWidth, thumbHeight));
          install(next);
        })
        .catch((error) => {
          if (cancelled) return;
          // Nothing has stepped in the worker, so the main-thread stepper is
          // still this session's only backend.
          console.warn('[WaterForceSystem] sim worker unavailable; stepping SWE on the main thread', error);
          demoteSweSimBackendToWasmMain();
          // The mount effect loads the main module; `wasmReady` re-runs this effect.
          const fallbackWasm = wasmRef.current;
          if (fallbackWasm) install(createWasmSweSim(fallbackWasm, budget.width, budget.height, budget.cellSize));
        });
    } else if (wasm) {
      install(createWasmSweSim(wasm, budget.width, budget.height, budget.cellSize));
    }

    return () => {
      cancelled = true;
      unsubscribeFatal?.();
      bindHeightfieldChoreWorker(null);
      sim?.dispose();
      host.grid = null;
      texture.dispose();
      flowTexture.dispose();
      host.texture = null;
      host.flowTexture = null;
      host.bed.valid = false;
      clearSWEBedSnapshot();
      updateSWEHeightFieldSnapshot({ enabled: false, texture: null, flowTexture: null });
      setSWEStatus(false, null);
    };
  }, [budget, wasmReady, loadMainWasm]);

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
    // Snow thickens the water the hull is in (#464): a lower flow cap on every
    // force path (main, sim worker, Rapier worker), more drag where the config
    // is built here. Identity for any other weather.
    const hull = weatherHullScale(getActiveWeather());
    const baseFlowSpeed = flowSpeed ?? getActiveGameplayProfile().flowCap;
    const hullFlowSpeed = baseFlowSpeed * hull.flowCapScale;
    const anchor = vehicleBody?.translation?.() ?? bodies[0].translation();

    // The field: window, scroll, bed, step, upload (sweHost.ts).
    const field = sweHostFrame(hostRef.current, budget, wasmRef.current, anchor, dt);
    const { originX, originZ } = field;
    originRef.current = { x: originX, z: originZ };

    // The forces, on one of two paths (waterForceBridge.ts / waterForceAuthority.ts).
    const simProxy = simProxyRef.current;
    const { owner, vehicleFlow } = applyWaterForces({
      bodies,
      vehicleBody,
      vehicleType,
      workerOwnsVehicleForces,
      anchor,
      grid: hostRef.current.grid,
      originX,
      originZ,
      sweEnabled: field.sweEnabled,
      dt,
      timeSeconds,
      flowSpeed: hullFlowSpeed,
      waterLevel,
      turbulenceStrength,
      turbulenceFrequency,
      dragScale: hull.dragScale,
      simProxy,
      requests: forceRequestsRef.current,
      vehicleFlowRef: workerVehicleFlowRef,
    });
    const requests = simProxy && !simProxy.failed ? forceRequestsRef.current : null;

    // The debug overlay's readout: a fresh object each frame, so only on a
    // debug / harness page (#521 D).
    if (debugGlobals && typeof window !== 'undefined') {
      (window as any).__watershedWaterForceSystem = {
        status: statusRef.current,
        origin: originRef.current,
        sampleCount: bodies.length,
        sweBudget: budget,
        workerOwnsVehicleForces,
        forcesIn: owner,
        forcesInFlight: requests?.inFlight ?? 0,
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
