/**
 * soundDefs.ts — the sound library, as data.
 *
 * Split out of AudioSystem.ts so the definitions can be checked without a Web
 * Audio context (soundDefs.test.ts hashes `public/sounds/` against this table).
 *
 * Two kinds of entry:
 *   - a **file** entry owns one `public/sounds/<file>` payload;
 *   - an **alias** entry (`aliasOf`) deliberately reuses another entry's file
 *     with its own mix settings. Aliases share the decoded buffer — one fetch,
 *     one decode — and are the *only* way two names may resolve to the same
 *     bytes. Two file entries pointing at identical payloads is the stub
 *     regression BUILD_HYGIENE.md §6.3 recorded, and the test fails on it.
 */

export enum SoundCategory {
  FOOTSTEP = 'footstep',
  JUMP = 'jump',
  LAND = 'land',
  COLLISION = 'collision',
  PADDLE = 'paddle',
  AMBIENT = 'ambient',
  UI = 'ui',
}

interface SoundMix {
  category: SoundCategory;
  baseVolume: number;
  basePitch: number;
  maxConcurrent: number;
}

export interface SoundFileDef extends SoundMix {
  /** Basename under `public/sounds/`. */
  file: string;
  /**
   * Continuous bed. After decode the buffer is re-seamed (loopBuffer.ts) so
   * MP3 priming/padding does not put a gap at the wrap.
   */
  loop?: boolean;
}

export interface SoundAliasDef extends SoundMix {
  /** Name of the file entry whose payload this reuses. */
  aliasOf: string;
}

export type SoundDef = SoundFileDef | SoundAliasDef;

export function isSoundAlias(def: SoundDef): def is SoundAliasDef {
  return 'aliasOf' in def;
}

const C = SoundCategory;

export const SOUND_DEFS: Record<string, SoundDef> = {
  // Footsteps
  step_rock: { file: 'footstep_rock.mp3', category: C.FOOTSTEP, baseVolume: 0.5, basePitch: 1.0, maxConcurrent: 2 },
  step_moss: { file: 'footstep_moss.mp3', category: C.FOOTSTEP, baseVolume: 0.4, basePitch: 0.9, maxConcurrent: 2 },
  step_wood: { file: 'footstep_wood.mp3', category: C.FOOTSTEP, baseVolume: 0.5, basePitch: 1.1, maxConcurrent: 2 },
  step_wet: { file: 'footstep_wet.mp3', category: C.FOOTSTEP, baseVolume: 0.6, basePitch: 0.8, maxConcurrent: 2 },

  // Jumps
  jump: { file: 'jump.mp3', category: C.JUMP, baseVolume: 0.7, basePitch: 1.0, maxConcurrent: 1 },
  double_jump: { file: 'jump_double.mp3', category: C.JUMP, baseVolume: 0.6, basePitch: 1.2, maxConcurrent: 1 },

  // Landings
  land_soft: { file: 'land_soft.mp3', category: C.LAND, baseVolume: 0.5, basePitch: 1.0, maxConcurrent: 1 },
  land_hard: { file: 'land_hard.mp3', category: C.LAND, baseVolume: 0.8, basePitch: 0.9, maxConcurrent: 1 },
  land_impact: { file: 'land_impact.mp3', category: C.LAND, baseVolume: 1.0, basePitch: 0.8, maxConcurrent: 1 },

  // Collisions — one per VehicleSystem wall surface
  collide_rock: { file: 'collide_rock.mp3', category: C.COLLISION, baseVolume: 0.7, basePitch: 1.0, maxConcurrent: 2 },
  collide_wood: { file: 'collide_wood.mp3', category: C.COLLISION, baseVolume: 0.6, basePitch: 0.9, maxConcurrent: 2 },
  collide_moss: { file: 'collide_moss.mp3', category: C.COLLISION, baseVolume: 0.4, basePitch: 1.1, maxConcurrent: 2 },
  collide_concrete: { file: 'collide_concrete.mp3', category: C.COLLISION, baseVolume: 0.7, basePitch: 0.95, maxConcurrent: 2 },
  splash: { file: 'splash.mp3', category: C.COLLISION, baseVolume: 0.8, basePitch: 1.0, maxConcurrent: 3 },
  collide_water: { aliasOf: 'splash', category: C.COLLISION, baseVolume: 0.8, basePitch: 1.0, maxConcurrent: 3 },

  // Raft
  paddle_left: { file: 'paddle_left.mp3', category: C.PADDLE, baseVolume: 0.6, basePitch: 1.0, maxConcurrent: 1 },
  paddle_right: { file: 'paddle_right.mp3', category: C.PADDLE, baseVolume: 0.6, basePitch: 1.0, maxConcurrent: 1 },
  raft_creak: { file: 'raft_creak.mp3', category: C.COLLISION, baseVolume: 0.7, basePitch: 1.0, maxConcurrent: 1 },
  water_crash: { file: 'water_crash.mp3', category: C.COLLISION, baseVolume: 1.0, basePitch: 0.9, maxConcurrent: 1 },
  // Names RaftVehicle/audio.ts has always asked for; they used to warn and fail.
  water_splash: { aliasOf: 'splash', category: C.COLLISION, baseVolume: 0.8, basePitch: 1.0, maxConcurrent: 3 },
  impact_wood: { aliasOf: 'collide_wood', category: C.COLLISION, baseVolume: 0.6, basePitch: 0.9, maxConcurrent: 2 },
  raft_tip: { aliasOf: 'water_crash', category: C.COLLISION, baseVolume: 0.9, basePitch: 0.9, maxConcurrent: 1 },

  // Vehicle tuning — boost, and the dodge dash that borrows it
  boost: { file: 'boost.mp3', category: C.UI, baseVolume: 0.9, basePitch: 1.0, maxConcurrent: 1 },
  dodge: { aliasOf: 'boost', category: C.UI, baseVolume: 0.8, basePitch: 1.0, maxConcurrent: 2 },

  // Water beds
  rapids_roar: { file: 'rapids_roar.mp3', loop: true, category: C.AMBIENT, baseVolume: 0.8, basePitch: 1.0, maxConcurrent: 1 },
  ambient_water: { file: 'ambient_water.mp3', loop: true, category: C.AMBIENT, baseVolume: 0.3, basePitch: 1.0, maxConcurrent: 1 },
  ambient_canyon: { file: 'ambient_canyon.mp3', loop: true, category: C.AMBIENT, baseVolume: 0.25, basePitch: 1.0, maxConcurrent: 1 },
  // Biome wind. Never the speed-wind bed — that one is synthesized
  // (speedWindBuffer.ts / the speed-wind worklet) so the two can't mask.
  ambient_wind: { file: 'ambient_wind.mp3', loop: true, category: C.AMBIENT, baseVolume: 0.2, basePitch: 1.0, maxConcurrent: 1 },

  // ReactiveAudio's layered stems — each a named mix of a bed above.
  water_close_gurgle: { aliasOf: 'ambient_water', category: C.AMBIENT, baseVolume: 0.6, basePitch: 1.0, maxConcurrent: 1 },
  water_mid_rapids: { aliasOf: 'rapids_roar', category: C.AMBIENT, baseVolume: 0.5, basePitch: 1.0, maxConcurrent: 1 },
  water_distant_roar: { aliasOf: 'ambient_canyon', category: C.AMBIENT, baseVolume: 0.4, basePitch: 1.0, maxConcurrent: 1 },
  water_whoosh: { aliasOf: 'ambient_wind', category: C.AMBIENT, baseVolume: 0.0, basePitch: 1.0, maxConcurrent: 1 },
};

/** The file entry a name resolves to (itself, or its alias target). */
export function resolveSoundFile(name: string): SoundFileDef | null {
  const def = SOUND_DEFS[name];
  if (!def) return null;
  if (!isSoundAlias(def)) return def;
  const target = SOUND_DEFS[def.aliasOf];
  return target && !isSoundAlias(target) ? target : null;
}

/**
 * Sounds fetched right after the unlock gesture — the ones that play in the
 * first seconds of a run. Everything else loads on first use.
 */
export const PRELOAD_SOUNDS: readonly string[] = [
  'jump',
  'land_soft',
  'step_rock',
  'collide_rock',
  'ambient_water',
  'rapids_roar',
  'splash',
];
