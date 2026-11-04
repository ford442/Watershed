/**
 * sweStageProbe — the live SWE stage η at a world XZ, for gameplay that reads the water (#522 A).
 *
 * The SWE host names its window each frame (`setSweStageWindow`, sweHost.ts,
 * next to the checksum grid); SimCore's context exposes `sampleSweStage` as
 * `ctx.water.stageAt`, so a hazard trigger reads the same field the hull and
 * the mesh do. On the `wasm-worker` backend the fields are the main-thread
 * mirror of the worker's last frame — one frame behind, in frame order, so a
 * replay reads the same numbers on the same step.
 *
 * A point outside the window (or no field at all: SWE is off at Low quality)
 * is `null`, never an edge cell's clamped value: a hazard 40 m downstream must
 * not read the stage at the window's lip as its own.
 */
import { bilinear } from './sampleSWEFlow';

/** The fields a stage read needs; any SweSim satisfies it. */
interface SweStageFields {
  readonly h: Float32Array;
  readonly width: number;
  readonly height: number;
  readonly dx: number;
}

/** One reused record: the host writes it every frame, so no per-frame object. */
const stageWindow = { fields: null as SweStageFields | null, originX: 0, originZ: 0 };

/** The SWE host's window this frame (null when the field is off or gone). */
export function setSweStageWindow(fields: SweStageFields | null, originX = 0, originZ = 0): void {
  stageWindow.fields = fields;
  stageWindow.originX = originX;
  stageWindow.originZ = originZ;
}

/** η (m above still water) at world (x, z), or null outside the window / with no field. */
export function sampleSweStage(x: number, z: number): number | null {
  const f = stageWindow.fields;
  if (!f || f.width <= 0 || f.height <= 0 || !(f.dx > 0) || f.h.length < f.width * f.height) return null;
  const gx = (x - stageWindow.originX) / f.dx;
  const gz = (z - stageWindow.originZ) / f.dx;
  if (!(gx >= 0 && gx <= f.width - 1 && gz >= 0 && gz <= f.height - 1)) return null;
  return bilinear(f.h, f.width, f.height, gx, gz);
}
