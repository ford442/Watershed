/**
 * createHeadlessRun.ts — a run with no browser (#556 B.1).
 *
 * Builds what the page builds for the runner on a map, in Node, with no three
 * scene and no React: SimCore and the same systems list the page registers
 * (experience/simSystems.ts), a Rapier world (@dimforge/rapier3d-compat, the
 * library the page's <Physics> wraps) with the player's capsule and the
 * treadmill's hull colliders, the shallow-water field on the shipped WASM with
 * its router, and the chunk treadmill (MapSystem + ChunkManager +
 * segmentMeshBuild). `stepHeadless` (stepHeadless.ts) advances it frame by
 * frame the way `stepScripted` advances the page.
 *
 * Process state. The sim's modules keep their state at module level (SimCore,
 * the run session, the segment frames, the bathymetry registry, the Zustand
 * run store, the recorders), so one process holds one headless run at a time:
 * `createHeadlessRun` resets that state and `run.dispose()` releases it.
 *
 * Headless only: never imported by app code (scripts/check-dependency-direction.mjs).
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GENERATION, PHYSICS, PLAYER_SPAWN } from '../../constants/game';
import { getMapDefinition, type MapRegistryId } from '../../maps/registry';
import { ProceduralMapManager } from '../../systems/map/MapSystem';
import { ChunkManager } from '../../systems/map/ChunkManager';
import { buildSegmentFrame, authoredGapT, clearSegmentFrames, publishSegmentFrames } from '../../systems/map/segmentFrames';
import { gameEvents } from '../../systems/events/GameEvents';
import { useGameStore, type QualityPreset } from '../../systems/GameState';
import {
  getActiveConditions,
  getActiveLaunchHour,
  initRunSession,
  resetRunSessionForTests,
  type RunConditions,
} from '../../systems/journey/runSession';
import { DEFAULT_FORECAST_INPUTS } from '../../constants/forecast';
import { buildForecastSamples, samplesToForecastByIndex } from '../../systems/map/flowForecast';
import { resetScoreSystemState } from '../../systems/score/ScoreSystem';
import { resetGhostRecording } from '../../systems/ghost/GhostRecorder';
import { initSplitRecordingListener, resetSplitRecording } from '../../systems/ghost/SplitRecorder';
import { setSegmentFlow } from '../../systems/water/segmentFlow';
import { clearSegmentBathymetry, unregisterSegmentBathymetry } from '../../systems/water/bathymetrySampler';
import { resetErosionFieldForTests } from '../../systems/water/erosionField';
import { sampleSweStage } from '../../systems/water/sweStageProbe';
import { loadHazardRuntime } from '../../systems/hazards/hazardSimSystem';
import { resolveRespawnSegment } from '../../systems/survival';
import { getMapSurvivalMetadata } from '../../maps/survivalMetadata';
import { CLEAR_WEATHER } from '../../systems/GameState';
import { createSimSystems } from '../../experience/simSystems';
import { createRapierWorldSimSystem } from '../../physics/rapierWorldSimSystem';
import { createRunnerSimSystem } from '../../vehicles/RunnerVehicle/runnerSimSystem';
import { createRunnerPhysicsState } from '../../vehicles/RunnerVehicle/hooks/runnerPhysicsState';
import { setProceduralSeedOverride, getProceduralBaseSeed, setVehicleOverride } from '../../utils/runContext';
import { setActiveUserRiver } from '../../systems/map/userRiverSession';
import { simCore } from '../core/SimCore';
import type { RapierBody, RapierNamespace, RapierWorld } from '../../physics/rapierTypes';
import { loadHeadlessNative } from './nativeNode';
import { SegmentWorld } from './segmentWorld';
import { createHeadlessWater, type HeadlessWater } from './headlessWater';
import { createHeadlessVehicleTuner, type HeadlessVehicleTuner } from './vehicleTunerFrame';
import type { WatershedNativeModule } from '../../systems/water/wasmAbi';
import type { InputSource } from '../../input/InputHub';

export interface HeadlessRunOptions {
  mapId: MapRegistryId;
  /** The run's launch hour (default: the saved preference's, i.e. the page default). */
  launchHour?: number;
  /** The day's conditions (weather script, melt); missing fields take the defaults. */
  conditions?: Partial<RunConditions>;
  /** Procedural base seed (`?seed=`; a replay's ghost carries one). */
  seed?: number;
  /** SWE budget preset (`?quality=`); the page default is medium. */
  quality?: QualityPreset;
  /** The WASM module, when the caller already holds one. */
  native?: WatershedNativeModule;
  /**
   * Behaviours of the page that are bugs, reproduced so a headless run matches it. Each defaults ON:
   * the point of the harness is the page's own numbers, and the browser smokes (and this pin) fail
   * the day the page is fixed, which is when the flag flips.
   */
  pageQuirks?: {
    /**
     * The treadmill renders 10 TrackSegment slots for 7 live segments; the 3 spare ones get no
     * `segmentId` and TrackSegment defaults it to 0, so their `useGeometries` effect (no meshes → no
     * bed) runs `unregisterSegmentBathymetry(0)`: the page has no SWE bed under segment 0, ever, on
     * a fresh pool. (TrackManager.tsx / TrackSegment/index.tsx / hooks/useGeometries.ts.)
     */
    spareSlotsDropBedZero?: boolean;
  };
}

/** How a headless run's treadmill ended, if it did. */
export interface HeadlessFinish {
  /** The segment whose `journeyComplete` the run reached. */
  segmentIndex: number;
  /** Sim steps at that moment. */
  stepIndex: number;
}

export interface HeadlessRun {
  readonly options: Readonly<HeadlessRunOptions>;
  readonly map: ReturnType<typeof getMapDefinition>;
  readonly world: RAPIER.World;
  readonly rapier: typeof RAPIER;
  readonly body: RAPIER.RigidBody;
  readonly camera: THREE.PerspectiveCamera;
  readonly chunk: ChunkManager;
  readonly segmentWorld: SegmentWorld;
  readonly water: HeadlessWater;
  readonly tuner: HeadlessVehicleTuner;
  readonly native: WatershedNativeModule;
  readonly runnerState: ReturnType<typeof createRunnerPhysicsState>;
  /** The page's clock for a stepped run: frames taken, and R3F's `elapsedTime` after the last. */
  readonly clock: { frame: number; simTimeSec: number; elapsed: number };
  /** The source stepHeadless last registered with the hub. */
  input: InputSource | null;
  /** Set once the treadmill reports the map's end. */
  finish: HeadlessFinish | null;
  /** Mount the treadmill / erosion changes the frames queued (see `stepHeadless`'s `commitEvery`). */
  commit(): void;
  /** True once something queued a pool or erosion change `commit` has not applied. */
  dirty: boolean;
  dispose(): void;
}

/** R3F's default `<Canvas camera={{ position: [0, 10, -10], fov: 75 }}>` (boot/RendererBoot.tsx). */
function createCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  camera.position.set(0, 10, -10);
  camera.updateMatrixWorld();
  return camera;
}

/** <Physics gravity={[0, PHYSICS.GRAVITY, 0]}> with the library's defaults (react-three-rapier). */
function createWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: PHYSICS.GRAVITY, z: 0 });
  const p = world.integrationParameters;
  p.numSolverIterations = 4;
  p.numInternalPgsIterations = 1;
  p.normalizedAllowedLinearError = 0.001;
  p.minIslandSize = 128;
  p.maxCcdSubsteps = 1;
  p.normalizedPredictionDistance = 0.002;
  p.contact_natural_frequency = 30;
  world.lengthUnit = 1;
  return world;
}

/** RunnerVehicle.tsx's body: dynamic, damped, one capsule collider. */
function createPlayerBody(world: RAPIER.World): RAPIER.RigidBody {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
  const [x, y, z] = PLAYER_SPAWN.position;
  body.setTranslation({ x, y, z }, false);
  body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, false);
  body.setLinearDamping(0.35);
  body.setAngularDamping(0.9);
  body.userData = { isPlayer: true };
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(0.4, 0.5), body);
  collider.setFriction(0.04);
  collider.setRestitution(0.15);
  body.setTranslation({ x, y, z }, true);
  return body;
}

let rapierReady: Promise<void> | null = null;

/** `RAPIER.init()` once per process. The compat build warns about its own call signature (the page's `useRapier` init does too); a campaign log is not the place for it. */
function initRapier(): Promise<void> {
  rapierReady ??= (async () => {
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].startsWith('using deprecated parameters')) return;
      warn(...args);
    };
    try {
      await RAPIER.init();
    } finally {
      console.warn = warn;
    }
  })();
  return rapierReady;
}

export async function createHeadlessRun(options: HeadlessRunOptions): Promise<HeadlessRun> {
  await initRapier();
  const native = options.native ?? (await loadHeadlessNative());
  const quality = options.quality ?? 'medium';
  const map = getMapDefinition(options.mapId);

  // --- A clean process state --------------------------------------------
  simCore.resetForTests();
  resetErosionFieldForTests();
  clearSegmentFrames();
  clearSegmentBathymetry();
  resetRunSessionForTests();
  resetGhostRecording();
  resetSplitRecording();
  useGameStore.getState().resetGameState();
  useGameStore.getState().setSettings({ quality });
  setActiveUserRiver(null);
  setVehicleOverride('runner');
  setProceduralSeedOverride(options.seed ?? null);

  // --- The run, as handleStart starts it ----------------------------------
  initRunSession({
    mapId: options.mapId,
    launchHour: options.launchHour,
    conditions: options.conditions,
    placedCacheIds: [],
    journeyMode: 'single',
  });
  const game = useGameStore.getState();
  game.setCurrentSegmentIndex(map.startIndex);
  game.setRespawnSegmentIndex(map.startIndex);
  game.setWaterfallGravityMultiplier(1.0);
  useGameStore.setState({ currentBiome: map.initialBiome, isPaused: false });
  game.setWeather(CLEAR_WEATHER);
  // A first run's flow is the module default until a segment is entered (resetRunSession, which
  // sets a map's own, runs on a restart only).
  setSegmentFlow(1, 0);

  // --- Physics ------------------------------------------------------------
  const world = createWorld();
  const body = createPlayerBody(world);
  const camera = createCamera();
  const runnerState = createRunnerPhysicsState();
  const segmentWorld = new SegmentWorld(world, RAPIER);

  // --- The treadmill ------------------------------------------------------
  const mapManager = new ProceduralMapManager(map.levelData, map.fallbackProgression, {}, map.continuation ?? null);
  let finish: HeadlessFinish | null = null;
  let dirty = false;
  const journeyHandled = new Set<number>();
  // `chunk` is assigned before initializePool, which calls back into these.
  // eslint-disable-next-line prefer-const
  let chunk: ChunkManager;

  const syncPool = () => {
    const active = chunk.getActiveSegments();
    const live = new Set(active.map((s) => s.id));
    for (const id of segmentWorld.ids()) if (!live.has(id)) segmentWorld.unmount(id);
    for (const segment of active) {
      if (segmentWorld.has(segment)) continue;
      const slipperiness = (mapManager.getChunkConfig?.(segment.id)?.slipperiness ?? 0) + (segment.slipperinessAdd ?? 0);
      segmentWorld.mount(segment, slipperiness);
    }
  };
  const publishFrames = () => {
    publishSegmentFrames(
      chunk.getActiveSegments().map((s) => buildSegmentFrame(
          s.id,
          s.segmentPath,
          mapManager.getChunkConfig?.(s.id)?.safeZone,
          authoredGapT(mapManager.getChunkConfig?.(s.id)),
        )),
    );
  };

  const checkJourneyComplete = (index: number) => {
    if (journeyHandled.has(index)) return;
    const cfg = mapManager.getChunkConfig?.(index);
    if (cfg?.journeyComplete) journeyHandled.add(index);
    if (cfg?.journeyComplete && !useGameStore.getState().isJourneyComplete) {
      finish = { segmentIndex: index, stepIndex: simCore.ctx.stepIndex };
      // The page's non-seamless finish also commits the timed best to storage; a headless run keeps none.
      useGameStore.getState().setJourneyComplete();
    }
  };

  chunk = new ChunkManager({
    mapManager,
    reachSegments: null,
    // The day's 24 h forecast from the launch hour: segment i takes hour i's flow state (FlowForecast → TrackManager).
    forecastByIndex: samplesToForecastByIndex(
      buildForecastSamples({
        ...DEFAULT_FORECAST_INPUTS,
        temperature: getActiveConditions().temperature,
        snowpackIndex: getActiveConditions().snowpackIndex,
        horizonHours: 24,
        startHour: getActiveLaunchHour(),
      }),
    ),
    startIndex: map.startIndex,
    proceduralBaseSeed: getProceduralBaseSeed(),
    callbacks: {
      onPoolChange: () => {
        publishFrames();
        dirty = true;
      },
      onBiomeChange: (biome) => {
        useGameStore.setState({ currentBiome: biome });
      },
      onSegmentEnter: (index) => {
        const entered = chunk.getActiveSegments().find((s) => s.id === index);
        const flowSpeed = entered?.flowSpeed ?? 1.0;
        const cfg = mapManager.getChunkConfig?.(index);
        const slipperiness = (cfg?.slipperiness ?? 0) + (entered?.slipperinessAdd ?? 0);
        setSegmentFlow(flowSpeed, slipperiness);
        gameEvents.emit('segment-enter', {
          segmentIndex: index,
          flowSpeed,
          gravityMultiplier: entered?.gravityMultiplier,
          slipperiness,
          segmentState: entered?.segmentState ?? 'Normal',
          surviveBonus: entered?.surviveBonus ?? 0,
          washedOutGap: Boolean(entered?.washedOutGap),
          forceVehicle: cfg?.forceVehicle ?? null,
        });
        checkJourneyComplete(index);
      },
      onSegmentGenerated: (index) => checkJourneyComplete(index),
    },
  });

  // The store-writing half of the page's segment events (useExperienceLifecycle), as plain handlers.
  const offs = [
    gameEvents.on('segment-enter', (detail) => {
      const store = useGameStore.getState();
      const index = detail.segmentIndex;
      store.setCurrentSegmentIndex(index);
      const survivalMeta = getMapSurvivalMetadata(options.mapId);
      store.setRespawnSegmentIndex(resolveRespawnSegment(survivalMeta.checkpoints ?? [], index));
      if (detail.gravityMultiplier !== undefined) store.setWaterfallGravityMultiplier(detail.gravityMultiplier);
      else if (index === 14) store.setWaterfallGravityMultiplier(1.45);
      else if (index === 15) store.setWaterfallGravityMultiplier(1.0);
      else if (index >= 23 && index <= 29) store.setWaterfallGravityMultiplier(1.2);
      else if (index === 30) store.setWaterfallGravityMultiplier(1.0);
    }),
    gameEvents.on('segment-spawn', ({ segmentIndex, spawnPoint }) => {
      useGameStore.getState().setSpawnPoint(segmentIndex, spawnPoint);
    }),
    gameEvents.on('segment-spawns', ({ points }) => {
      if (Object.keys(points).length > 0) useGameStore.getState().setSpawnPoints(points);
    }),
    gameEvents.on('watershed-run-reset', () => simCore.reset()),
  ];
  initSplitRecordingListener();

  chunk.initializePool();
  syncPool();
  dirty = false;
  // The pool's spare slots mount after the live ones and take segment 0's bed with them (see pageQuirks).
  if (options.pageQuirks?.spareSlotsDropBedZero !== false && GENERATION.POOL_SIZE > GENERATION.MAX_ACTIVE_SEGMENTS) {
    unregisterSegmentBathymetry(0);
  }

  // --- Water --------------------------------------------------------------
  const water = createHeadlessWater(native, quality, body as unknown as RapierBody);

  // --- SimCore: the page's list, the world step, the runner ----------------
  const stages = {
    isStageEnabled: () => true,
    setStageFailure: (_stage: string, error: unknown) => {
      throw error instanceof Error ? error : new Error(String(error));
    },
  };
  for (const system of createSimSystems(stages)) simCore.register(system);
  const eventQueue = new RAPIER.EventQueue(false);
  simCore.register(
    createRapierWorldSimSystem((dt) => {
      world.timestep = dt;
      world.step(eventQueue);
    }),
  );
  simCore.register(
    createRunnerSimSystem({
      world: world as unknown as RapierWorld,
      rapier: RAPIER as unknown as RapierNamespace,
      getBody: () => body as unknown as RapierBody,
      camera,
      vehicleState: runnerState,
      shelfLaunchFiredRef: { current: false },
      shelfTriggerRef: { current: null },
    }),
  );
  simCore.ctx.water.stageAt = sampleSweStage;
  simCore.ctx.game = { state: () => useGameStore.getState() };

  // The map's hazards are a lazy chunk; frame 0 must not race it (the page's readiness gate).
  await loadHazardRuntime();

  // The page's mount effect: score / ghost recording / split recorder reset, the sim clock to zero.
  resetScoreSystemState();

  const run: HeadlessRun = {
    options,
    map,
    world,
    rapier: RAPIER,
    body,
    camera,
    chunk,
    segmentWorld,
    water,
    tuner: createHeadlessVehicleTuner(world, RAPIER),
    native,
    runnerState,
    clock: { frame: 0, simTimeSec: 0, elapsed: 0 },
    input: null,
    get finish() {
      return finish;
    },
    set finish(next) {
      finish = next;
    },
    get dirty() {
      return dirty;
    },
    set dirty(next) {
      dirty = next;
    },
    commit() {
      if (dirty) {
        syncPool();
        dirty = false;
      }
      segmentWorld.refreshErosion();
    },
    dispose() {
      for (const off of offs) off();
      water.dispose();
      segmentWorld.dispose();
      chunk.dispose();
      clearSegmentFrames();
      clearSegmentBathymetry();
      resetErosionFieldForTests();
      resetGhostRecording();
      resetSplitRecording();
      simCore.resetForTests();
      world.free();
    },
  };
  return run;
}
