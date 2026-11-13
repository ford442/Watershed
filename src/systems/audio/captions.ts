/**
 * captions.ts — gameplay sounds as text (#558 C.3).
 *
 * While the caption layer is up it registers `captionSound` as the
 * AudioManager's sound captioner (accessRuntime), so for every one-shot it plays
 * the ones a
 * player needs (impacts, splashes, a capsize, a boost) become a `caption` event
 * with the direction they came from. Hazards caption their phases here too —
 * their telegraph is the warning, so it is captioned whether or not a stem
 * plays for it yet (#553 A.4 adds the stems). CaptionLayer renders the events.
 *
 * Nothing is emitted unless the player turned captions on (accessRuntime), so a
 * player without them pays one boolean read per sound.
 */

import * as THREE from 'three';
import { gameEvents, type CaptionDetail, type Vec3Like } from '../events/GameEvents';
import { captionsEnabled } from '../settings/accessRuntime';

/** Sounds that carry gameplay information → caption id and priority. Footsteps, paddles, beds: none. */
export const CAPTION_FOR_SOUND: Readonly<Record<string, { id: string; priority: number }>> = {
  splash: { id: 'splash', priority: 1 },
  water_splash: { id: 'splash', priority: 1 },
  collide_water: { id: 'splash', priority: 1 },
  water_crash: { id: 'waterCrash', priority: 2 },
  raft_tip: { id: 'raftTip', priority: 3 },
  collide_rock: { id: 'impact', priority: 2 },
  collide_wood: { id: 'impact', priority: 2 },
  collide_concrete: { id: 'impact', priority: 2 },
  collide_moss: { id: 'impact', priority: 2 },
  land_hard: { id: 'hardLanding', priority: 1 },
  land_impact: { id: 'hardLanding', priority: 2 },
  boost: { id: 'boost', priority: 1 },
};

/** Within this lateral share of the distance a sound reads as "ahead". */
const CENTRE_CONE = 0.35;
const scratch = new THREE.Vector3();

/**
 * Left / right of `listener` (the camera's AudioListener) for a world position.
 * 0 with no position or no listener.
 */
export function captionDirection(listener: THREE.Object3D | null, pos: Vec3Like | null | undefined): -1 | 0 | 1 {
  if (!listener || !pos) return 0;
  listener.updateWorldMatrix(true, false);
  scratch.set(pos.x, pos.y, pos.z);
  listener.worldToLocal(scratch);
  const d = Math.hypot(scratch.x, scratch.z);
  if (d < 1e-3 || Math.abs(scratch.x) < d * CENTRE_CONE) return 0;
  return scratch.x < 0 ? -1 : 1;
}

const detail: CaptionDetail = { id: '', direction: 0, priority: 0 };

export function emitCaption(id: string, direction: -1 | 0 | 1, priority: number, seconds?: number): void {
  if (!captionsEnabled()) return;
  detail.id = id;
  detail.direction = direction;
  detail.priority = priority;
  if (seconds === undefined) delete detail.seconds;
  else detail.seconds = seconds;
  gameEvents.emit('caption', detail);
}

/** AudioManager.playSound's hook (registered by CaptionLayer). */
export function captionSound(name: string, listener: unknown, position?: Vec3Like | null): void {
  if (!captionsEnabled()) return;
  const entry = CAPTION_FOR_SOUND[name];
  if (!entry) return;
  emitCaption(
    entry.id,
    captionDirection(listener instanceof THREE.Object3D ? listener : null, position),
    entry.priority,
  );
}

let bridged: (() => void) | null = null;

/**
 * Caption the hazards' phases and hits (idempotent). `getListener` is the
 * AudioListener for direction; null until audio boots (captions say "ahead").
 */
export function startHazardCaptions(getListener: () => THREE.Object3D | null): () => void {
  if (bridged) return bridged;
  const offPhase = gameEvents.on('hazard-phase', (e) => {
    if (e.phase !== 'telegraph' && e.phase !== 'active') return;
    emitCaption(
      `${e.kind}.${e.phase}`,
      captionDirection(getListener(), e.anchor),
      3,
      e.phase === 'telegraph' && e.warnSeconds !== undefined ? Math.round(e.warnSeconds) : undefined,
    );
  });
  const offHit = gameEvents.on('hazard-hit', () => emitCaption('hazardHit', 0, 3));
  bridged = () => {
    offPhase();
    offHit();
    bridged = null;
  };
  return bridged;
}
