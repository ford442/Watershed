/**
 * The layout pass's working state (#559 C): the segment's layout flags and
 * widths, the current station (`s`, channel shape, tangent, bend) and the
 * current bank (`side`, `edge`, `riffle`) — what the category steps read.
 *
 * The layout walks the segment in ~2 m stations and, at each, the two banks;
 * the steps run in a fixed order at every (station, side). A segment's layout
 * runs synchronously to completion, so its state lives in these module
 * bindings, written only here — `beginSegment` once per build, then
 * `setRowStation` / `setRowSide` before each round of steps — and read by the
 * family modules as plain names, as the legacy single function read its
 * locals. (Bindings, not a context object: an object's property names survive
 * minification, and the builder ships twice — the entry and the sim worker.)
 *
 * Each category draws from its own seeded sub-stream (`PlacementRngs`), so a
 * draw added to one never shifts another.
 */

import { WATER_LEVEL } from '../../constants/game';
import type { Rng } from '../../math/random';
import type { ChannelShape } from '../types';
import { sampleChannelShape } from '../terrainTile';
import type { GeometryBuildContext } from '../segmentMeshBuild';
import type { Vec3 } from '../meshMath';
import type { PlacementCategory } from './format';
import type { PropLayoutSpec, SegmentPlacementInput } from './inputs';
import type { PlacementWriter } from './writer';
import { pathTangent } from './frame';

export type PlacementRngs = Record<PlacementCategory, Rng>;

/** One category step at the current (station, side). */
export type PlacementStep = (w: PlacementWriter, R: PlacementRngs) => void;

/** Shorthands every family uses. */
export const W = WATER_LEVEL;
export const PI = Math.PI;

// --- The segment (set by beginSegment) -------------------------------------

export let input: SegmentPlacementInput;
export let L: PropLayoutSpec;
/** Path length (m). */
export let len = 0;
export let canyonWidth = 0;
export let waterWidth = 0;
/** canyonWidth / 2. */
export let half = 0;
/** waterWidth / 2: the wetted bank edge of the nominal channel. */
export let bankStart = 0;
export let slot = false;
export let glacier = false;
export let pond = false;
export let autumn = false;
export let tube = false;

// --- The station (set by setRowStation) ------------------------------------

/** Path parameter of this station. */
export let s = 0;
export let shape: ChannelShape;
export let tangent: Vec3;
export let curvatureStrength = 0;
/** The inside of the bend (−1 left, +1 right). */
export let insideSide = 1;
export let flowYaw = 0;

// --- The bank (set by setRowSide) ------------------------------------------

/** −1 left, +1 right. */
export let side = -1;
/** Wetted half-width on `side`. */
export let edge = 0;
export let riffle = 0;

export function beginSegment(ctx: GeometryBuildContext, segmentInput: SegmentPlacementInput, pathLength: number): void {
  input = segmentInput;
  L = segmentInput.layout;
  len = pathLength;
  canyonWidth = ctx.canyonWidth;
  waterWidth = ctx.waterWidth;
  half = canyonWidth / 2;
  bankStart = waterWidth / 2;
  slot = L.isSlotCanyon;
  glacier = L.isGlacier;
  pond = L.segmentType === 'pond';
  autumn = L.isAutumnLike;
  tube = !!ctx.tubeProfile;
}

/** Move to station `station` (of `zSteps`): channel shape, tangent, bend. */
export function setRowStation(ctx: GeometryBuildContext, station: number, zSteps: number): void {
  s = station;
  shape = sampleChannelShape(ctx.channelProfile, waterWidth, station);
  tangent = pathTangent(ctx.segmentPath, station);
  const sNext = Math.min(1, station + 1 / Math.max(1, zSteps));
  const tangentNext = pathTangent(ctx.segmentPath, sNext);
  const curvatureY = tangent.z * tangentNext.x - tangent.x * tangentNext.z;
  curvatureStrength = Math.abs(curvatureY);
  insideSide = curvatureY > 0 ? -1 : 1;
  flowYaw = Math.atan2(tangent.x, tangent.z);
}

/** Move to bank `bank` at the current station. */
export function setRowSide(bank: number): void {
  side = bank;
  edge = bank < 0 ? shape.leftHalfWidth : shape.rightHalfWidth;
  riffle = Math.max(0, shape.riffleStrength);
}

/** `metres` along the path as a path-parameter offset. */
export const ds = (metres: number): number => metres / len;

/** Lateral `u` bank units out from the bank edge on `side` (0 = wetted edge, 1 = tile edge). */
export const bankUnits = (side: number, edge: number, u: number): number => side * (edge + u * Math.max(0, half - edge));
