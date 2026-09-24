/**
 * ghostExport.ts — Offline export/import of personal-best ghost runs.
 *
 * File format: JSON with `.wsghost` extension.
 * Validates mapId and codec version on import to reject wrong-map ghosts, and —
 * when the caller passes the live run's fairness — refuses a ghost recorded at
 * a different launch hour or hydro event set (#449 E1).
 */

import { GHOST_CODEC_VERSION, type RunSplitEntry } from './ghostCodec';
import { fairnessFromGhostFile, judgeGhostFairness, type GhostHydroFairness } from './hydroFairness';
import type { QualityPreset } from '../GameState';

export const WSGHOST_MIME = 'application/json';
export const WSGHOST_EXTENSION = '.wsghost';

export interface WsGhostFile {
  /** File format version. Import accepts anything <= GHOST_CODEC_VERSION. */
  codecVersion: number;
  /** Map this ghost was recorded on. Import rejects mismatches. */
  mapId: string;
  /** Run time in milliseconds. */
  timeMs: number;
  /** Base64 delta-encoded ghost payload (from ghostCodec). */
  ghostData: string;
  /** Unix timestamp (ms) of export. */
  exportedAt: number;
  /** Checkpoint splits (codecVersion >= 2). Absent on v1 files. */
  splits?: RunSplitEntry[];
  /** Launch hour 0–23 (codecVersion >= 3). */
  launchHour?: number;
  /** Hash of hydroEvents live at that hour (codecVersion >= 3). */
  hydroEventHash?: string;
  /** Graphics quality the run used (codecVersion >= 3). */
  qualityPreset?: QualityPreset;
}

export type GhostImportResult =
  | { ok: true; file: WsGhostFile }
  | { ok: false; reason: 'invalid_json' | 'invalid_format' | 'version_mismatch' | 'map_mismatch' }
  | { ok: false; reason: 'hour_mismatch' | 'hydro_mismatch'; message: string };

/**
 * Serialise a ghost payload to a downloadable WsGhostFile JSON string.
 */
export function exportGhostToJson(
  mapId: string,
  timeMs: number,
  ghostData: string,
  splits?: RunSplitEntry[],
  fairness?: GhostHydroFairness,
): string {
  const file: WsGhostFile = {
    codecVersion: GHOST_CODEC_VERSION,
    mapId,
    timeMs,
    ghostData,
    exportedAt: Date.now(),
    ...(splits && splits.length > 0 ? { splits } : {}),
    ...(fairness?.launchHour !== undefined ? { launchHour: fairness.launchHour } : {}),
    ...(fairness?.hydroEventHash ? { hydroEventHash: fairness.hydroEventHash } : {}),
    ...(fairness?.qualityPreset ? { qualityPreset: fairness.qualityPreset } : {}),
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Trigger a browser download of the ghost file.
 * No-op outside browser contexts (e.g. tests / SSR).
 */
export function downloadGhostFile(
  mapId: string,
  timeMs: number,
  ghostData: string,
  splits?: RunSplitEntry[],
  filename?: string,
  fairness?: GhostHydroFairness,
): void {
  if (typeof document === 'undefined') return;

  const json = exportGhostToJson(mapId, timeMs, ghostData, splits, fairness);
  const blob = new Blob([json], { type: WSGHOST_MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename ?? `${mapId}_ghost${WSGHOST_EXTENSION}`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * `lumber_H14.wsghost` — the hour is in the name so a shared file says which
 * river it raced before anyone opens it.
 */
export function ghostShareFilename(mapId: string, launchHour?: number): string {
  const hour = launchHour !== undefined ? `_H${String(launchHour).padStart(2, '0')}` : '';
  return `${mapId}${hour}${WSGHOST_EXTENSION}`;
}

/**
 * Same-origin link that races this ghost: `?map=…&hour=…&ghost=./<file>`.
 * The player hosts the downloaded file next to the game build; `?ghost=` stays
 * same-origin-only and silent on 404 (rivalGhostUrl.ts). No backend.
 */
export function buildGhostShareUrl(
  location: Pick<Location, 'origin' | 'pathname'>,
  mapId: string,
  launchHour: number | undefined,
  filename: string = ghostShareFilename(mapId, launchHour),
): string {
  // Hand-built (not URLSearchParams) so `./` stays readable in a pasted link.
  const params = [`map=${encodeURIComponent(mapId)}`];
  if (launchHour !== undefined) params.push(`hour=${launchHour}`);
  params.push(`ghost=./${encodeURIComponent(filename)}`);
  return `${location.origin}${location.pathname}?${params.join('&')}`;
}

function isRunSplitEntry(value: unknown): value is RunSplitEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.segmentIndex === 'number' &&
    typeof v.tMs === 'number' &&
    v.tMs >= 0 &&
    typeof v.speed === 'number'
  );
}

function isWsGhostFile(value: unknown): value is WsGhostFile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (
    !(
      typeof v.codecVersion === 'number' &&
      typeof v.mapId === 'string' &&
      v.mapId.length > 0 &&
      typeof v.timeMs === 'number' &&
      v.timeMs >= 0 &&
      typeof v.ghostData === 'string' &&
      v.ghostData.length > 0 &&
      typeof v.exportedAt === 'number'
    )
  ) {
    return false;
  }
  if (v.splits !== undefined && (!Array.isArray(v.splits) || !v.splits.every(isRunSplitEntry))) {
    return false;
  }
  if (v.launchHour !== undefined && (typeof v.launchHour !== 'number' || v.launchHour < 0 || v.launchHour > 23)) {
    return false;
  }
  if (v.hydroEventHash !== undefined && typeof v.hydroEventHash !== 'string') {
    return false;
  }
  if (
    v.qualityPreset !== undefined &&
    (typeof v.qualityPreset !== 'string' ||
      !['low', 'medium', 'high', 'ultra'].includes(v.qualityPreset))
  ) {
    return false;
  }
  return true;
}

/**
 * Parse and validate an imported WsGhostFile JSON string.
 * Pass `expectedMapId` to reject ghosts recorded on a different map, and
 * `expectedFairness` (the live run's hour/hash) to refuse a ghost from a
 * different river. Pre-v3 files have no hour/hash and are not refused here.
 *
 * `codecVersion` accepts anything up to the current GHOST_CODEC_VERSION — a v1
 * file (no `splits`) is a valid, poses-only v3 file; only a *newer* file than
 * this build understands is rejected.
 */
export function importGhostFromJson(
  json: string,
  expectedMapId?: string,
  expectedFairness?: GhostHydroFairness,
): GhostImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!isWsGhostFile(parsed)) {
    return { ok: false, reason: 'invalid_format' };
  }

  if (parsed.codecVersion > GHOST_CODEC_VERSION) {
    return { ok: false, reason: 'version_mismatch' };
  }

  if (expectedMapId !== undefined && parsed.mapId !== expectedMapId) {
    return { ok: false, reason: 'map_mismatch' };
  }

  if (expectedFairness) {
    const verdict = judgeGhostFairness(expectedFairness, fairnessFromGhostFile(parsed), 'rival');
    if (verdict.kind === 'refused') {
      return { ok: false, reason: verdict.reason, message: verdict.message };
    }
  }

  return { ok: true, file: parsed };
}

/**
 * Read a File object (from drag-drop or file-input) and parse it.
 * Resolves with the import result; rejects only on unexpected API errors.
 */
export async function importGhostFromFile(
  file: File,
  expectedMapId?: string,
  expectedFairness?: GhostHydroFairness,
): Promise<GhostImportResult> {
  const text = await file.text();
  return importGhostFromJson(text, expectedMapId, expectedFairness);
}
