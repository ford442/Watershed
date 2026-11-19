/**
 * HazardTelegraph.tsx — a hazard's warning, in the world and in the hands (#578 A.2).
 *
 * Mounted (lazily, in the scene) only while a hazard is up (`useHazardsUp`).
 * For every hazard that raises the water (a `release`, hazardLive's `stage`):
 *
 *  - a wall band at the predicted waterline and a water-edge decal at the
 *    predicted surface (telegraphGeometry.ts, on the segment's own hull), in the
 *    colour-vision palette's `telegraphArmed` / `telegraphWarn` /
 *    `telegraphActive` (#558: `getAccessPalette()`, repainted when the player
 *    changes mode). Armed draws a faint band only; the telegraph pulses band and
 *    decal; active holds them solid until the hazard is spent.
 *  - as it starts to telegraph: the dam horn (hornBuffer.ts, played through
 *    AudioManager.playSynthOneShot and captioned
 *    as "Dam horn" beside the countdown the caption layer already shows) and a
 *    `warn` rumble on a gamepad.
 *
 * The colour is never the only signal: the HUD banner (HazardBanner.tsx) says it
 * with a glyph and a word, and the captions say it as text. This component reads
 * hazardLive and steps nothing: the hazards are sim state (SimCore's `hazards`).
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { WATER_LEVEL } from '../../constants/game';
import { getSegmentFrames, getSegmentFramesVersion } from '../../systems/map/segmentFrames';
import { getBathymetryRevision, getRegisteredBathymetrySource } from '../../systems/water/bathymetrySampler';
import { getLiveHazards, getLiveHazardsVersion, type LiveHazard, type LiveHazardPhase } from '../../systems/hazards/hazardLive';
import { getAccessPalette, subscribeAccess } from '../../systems/settings/accessRuntime';
import type { AccessPalette } from '../../systems/settings/access';
import { getAudioManager } from '../../systems/audio/AudioSystem';
import { createHornBuffer } from '../../systems/audio/hornBuffer';
import { pulse } from '../../input/haptics';
import { buildTelegraphBuffers } from './telegraphGeometry';

const PHASE_COLOUR: Record<LiveHazardPhase, keyof AccessPalette> = {
  armed: 'telegraphArmed',
  telegraph: 'telegraphWarn',
  active: 'telegraphActive',
};
/** Band / decal opacity per phase; the telegraph pulses around its value. */
const BAND_OPACITY: Record<LiveHazardPhase, number> = { armed: 0.35, telegraph: 0.7, active: 0.85 };
const DECAL_OPACITY: Record<LiveHazardPhase, number> = { armed: 0, telegraph: 0.16, active: 0.24 };
/** Telegraph pulse, Hz and depth. */
const PULSE_HZ = 1.6;
const PULSE_DEPTH = 0.35;
const HORN_VOLUME = 0.9;

interface Drawn {
  id: string;
  phase: LiveHazardPhase;
  band: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  decal: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

function geometryOf(positions: Float32Array, index: Uint32Array): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The band lies on both walls, so it is two-sided. The decal is the surface to
 * come seen from above: one-sided, facing up (telegraphGeometry winds it so), so
 * a player already under that height is not looking up at a coloured ceiling.
 */
function materialOf(side: THREE.Side): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    side,
    toneMapped: false,
    // Lie on the wall / the water without fighting it for depth.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

function drawn(hazard: LiveHazard): Drawn | null {
  if (hazard.stage === null || !hazard.anchor) return null;
  const buffers = buildTelegraphBuffers({
    anchor: hazard.anchor,
    radius: hazard.radius,
    reachHeight: WATER_LEVEL + hazard.stage,
    frames: getSegmentFrames(),
    floorFor: (index) => getRegisteredBathymetrySource(index) ?? null,
  });
  if (buffers.band.index.length === 0 && buffers.decal.index.length === 0) return null;
  const band = new THREE.Mesh(geometryOf(buffers.band.positions, buffers.band.index), materialOf(THREE.DoubleSide));
  const decal = new THREE.Mesh(geometryOf(buffers.decal.positions, buffers.decal.index), materialOf(THREE.FrontSide));
  band.renderOrder = 6;
  decal.renderOrder = 5;
  band.frustumCulled = decal.frustumCulled = false;
  return { id: hazard.id, phase: hazard.phase, band, decal };
}

function dispose(d: Drawn): void {
  d.band.geometry.dispose();
  d.band.material.dispose();
  d.decal.geometry.dispose();
  d.decal.material.dispose();
}

/** A telegraph starts: the horn (a dam's) and a rumble. Once per hazard per mount. */
function cue(hazard: LiveHazard): void {
  if (hazard.kind === 'damRelease') {
    const at = hazard.anchor ? new THREE.Vector3(hazard.anchor[0], hazard.anchor[1], hazard.anchor[2]) : undefined;
    getAudioManager()?.playSynthOneShot('dam_horn', createHornBuffer, HORN_VOLUME, at);
  }
  pulse('warn');
}

/** Colour each drawn telegraph for its phase in the live palette. */
function paint(list: readonly Drawn[]): void {
  const palette = getAccessPalette();
  for (const d of list) {
    const colour = palette[PHASE_COLOUR[d.phase]];
    d.band.material.color.set(colour);
    d.decal.material.color.set(colour);
    d.decal.visible = DECAL_OPACITY[d.phase] > 0;
  }
}

interface TelegraphState {
  hazardsVersion: number;
  framesVersion: number;
  bedRevision: number;
  drawn: Drawn[];
  /** Hazards whose telegraph has been cued this mount. */
  cued: Set<string>;
}

export default function HazardTelegraph(): React.ReactElement {
  const group = useMemo(() => new THREE.Group(), []);
  const state = useMemo<TelegraphState>(
    () => ({ hazardsVersion: -1, framesVersion: -1, bedRevision: -1, drawn: [], cued: new Set() }),
    [],
  );

  useEffect(() => subscribeAccess(() => paint(state.drawn)), [state]);

  useEffect(
    () => () => {
      for (const d of state.drawn) dispose(d);
      state.drawn = [];
      group.clear();
    },
    [group, state],
  );

  useFrame(({ clock }) => {
    const s = state;
    const hazardsVersion = getLiveHazardsVersion();
    const framesVersion = getSegmentFramesVersion();
    const bedRevision = getBathymetryRevision();
    if (hazardsVersion !== s.hazardsVersion || framesVersion !== s.framesVersion || bedRevision !== s.bedRevision) {
      s.hazardsVersion = hazardsVersion;
      s.framesVersion = framesVersion;
      s.bedRevision = bedRevision;
      for (const d of s.drawn) dispose(d);
      group.clear();
      s.drawn = [];
      for (const hazard of getLiveHazards()) {
        if (hazard.phase !== 'armed' && !s.cued.has(hazard.id)) {
          s.cued.add(hazard.id);
          // Only a telegraph's own start is cued; a late mount mid-active stays quiet.
          if (hazard.phase === 'telegraph') cue(hazard);
        }
        const d = drawn(hazard);
        if (!d) continue;
        s.drawn.push(d);
        group.add(d.decal, d.band);
      }
      paint(s.drawn);
    }
    // Pulse while telegraphing; hold steady otherwise. Render-side clock: a look, not sim state.
    const wave = 1 + PULSE_DEPTH * Math.sin(clock.elapsedTime * Math.PI * 2 * PULSE_HZ);
    for (const d of s.drawn) {
      const k = d.phase === 'telegraph' ? wave : 1;
      d.band.material.opacity = Math.min(1, BAND_OPACITY[d.phase] * k);
      d.decal.material.opacity = Math.min(1, DECAL_OPACITY[d.phase] * k);
    }
  });

  return <primitive object={group} />;
}
