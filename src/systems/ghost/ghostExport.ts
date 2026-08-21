/**
 * ghostExport.ts — Offline export/import of personal-best ghost runs.
 *
 * File format: JSON with `.wsghost` extension.
 * Validates mapId and codec version on import to reject wrong-map ghosts.
 */

import { GHOST_CODEC_VERSION, type RunSplitEntry } from './ghostCodec';

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
}

export type GhostImportResult =
  | { ok: true; file: WsGhostFile }
  | { ok: false; reason: 'invalid_json' | 'invalid_format' | 'version_mismatch' | 'map_mismatch' };

/**
 * Serialise a ghost payload to a downloadable WsGhostFile JSON string.
 */
export function exportGhostToJson(
  mapId: string,
  timeMs: number,
  ghostData: string,
  splits?: RunSplitEntry[],
): string {
  const file: WsGhostFile = {
    codecVersion: GHOST_CODEC_VERSION,
    mapId,
    timeMs,
    ghostData,
    exportedAt: Date.now(),
    ...(splits && splits.length > 0 ? { splits } : {}),
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
): void {
  if (typeof document === 'undefined') return;

  const json = exportGhostToJson(mapId, timeMs, ghostData, splits);
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
  return true;
}

/**
 * Parse and validate an imported WsGhostFile JSON string.
 * Pass `expectedMapId` to reject ghosts recorded on a different map.
 *
 * `codecVersion` accepts anything up to the current GHOST_CODEC_VERSION — a v1
 * file (no `splits`) is a valid, poses-only v2 file; only a *newer* file than
 * this build understands is rejected.
 */
export function importGhostFromJson(
  json: string,
  expectedMapId?: string,
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

  return { ok: true, file: parsed };
}

/**
 * Read a File object (from drag-drop or file-input) and parse it.
 * Resolves with the import result; rejects only on unexpected API errors.
 */
export async function importGhostFromFile(
  file: File,
  expectedMapId?: string,
): Promise<GhostImportResult> {
  const text = await file.text();
  return importGhostFromJson(text, expectedMapId);
}
