/**
 * RunResultsPanel.tsx — split table + PB/rival comparison shown inside the
 * journey-complete and wipeout overlays (GameHUD).
 *
 * `complete` reads the authoritative snapshot commitTimedFinish() left behind
 * (this run's splits diffed against the PB as it stood *before* this run —
 * see runFinish.ts for why that snapshot exists instead of a live read).
 * `wipeout` has no snapshot (a DNF never commits a PB) — it reads live
 * partial splits and the untouched, still-current PB for comparison.
 */

import { useMemo, useState } from 'react';
import { getActiveMapId, getActiveRunKey } from '../utils/runContext';
import { getRunBest, getRivalGhost } from '../systems/persistence/PersistenceSystem';
import { getRecordedSplits } from '../systems/ghost/SplitRecorder';
import { getGhostElapsedMs, getCurrentGhostPayload } from '../systems/ghost/GhostRecorder';
import { getLastFinishSummary } from '../systems/ghost/runFinish';
import { downloadGhostFile } from '../systems/ghost/ghostExport';
import { formatRaceTimeMs } from '../systems/ghost/raceTimeFormat';
import type { RunSplitEntry } from '../systems/ghost/ghostCodec';
import {
  buildGhostHydroFairness,
  describeHydroFairnessMismatch,
  describeHydroSplitBlame,
  fairnessFromGhostFile,
} from '../systems/ghost/hydroFairness';
import { getActiveLaunchHour } from '../systems/journey/runSession';
import { getQualityPresetNow } from '../systems/GameState';
import { getActiveMap } from '../maps/registry';
import { parseHydroEvents } from '../systems/water/hydroEvents';

interface RunResultsPanelProps {
  outcome: 'complete' | 'wipeout';
}

interface SplitRow {
  segmentIndex: number;
  tMs: number;
  deltaMs: number | null;
  tier: 'gold' | 'green' | 'red' | 'neutral';
}

function buildSplitRows(thisRun: RunSplitEntry[], reference?: RunSplitEntry[]): SplitRow[] {
  const byIndex = new Map(reference?.map((s) => [s.segmentIndex, s]) ?? []);
  return thisRun
    .slice()
    .sort((a, b) => a.segmentIndex - b.segmentIndex)
    .map((entry) => {
      const ref = byIndex.get(entry.segmentIndex);
      if (!ref) return { segmentIndex: entry.segmentIndex, tMs: entry.tMs, deltaMs: null, tier: 'neutral' as const };
      const deltaMs = entry.tMs - ref.tMs;
      const tier = deltaMs < 0 ? 'gold' : deltaMs === 0 ? 'green' : 'red';
      return { segmentIndex: entry.segmentIndex, tMs: entry.tMs, deltaMs, tier };
    });
}

function formatSignedMs(deltaMs: number): string {
  const sign = deltaMs <= 0 ? '−' : '+';
  return `${sign}${formatRaceTimeMs(Math.abs(deltaMs))}`;
}

function splitsAsText(mapId: string, timeMs: number, rows: SplitRow[]): string {
  const lines = [`${mapId} — ${formatRaceTimeMs(timeMs)}`];
  for (const row of rows) {
    const delta = row.deltaMs === null ? '' : `  (${formatSignedMs(row.deltaMs)})`;
    lines.push(`  SEG ${row.segmentIndex}  ${formatRaceTimeMs(row.tMs)}${delta}`);
  }
  return lines.join('\n');
}

export default function RunResultsPanel({ outcome }: RunResultsPanelProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  const mapId = useMemo(() => getActiveMapId(), []);
  const runKey = useMemo(() => getActiveRunKey(mapId), [mapId]);

  const summary = outcome === 'complete' ? getLastFinishSummary() : null;
  const pb = getRunBest(runKey);
  const rival = getRivalGhost(mapId);

  const thisRunSplits = summary?.splits ?? getRecordedSplits();
  const thisRunTimeMs = summary?.timeMs ?? (outcome === 'complete' ? getGhostElapsedMs() : null);
  const referenceSplits = outcome === 'complete' ? summary?.previousSplits : pb.splits;
  const referenceTimeMs = outcome === 'complete' ? summary?.previousBestTimeMs : pb.bestTimeMs;
  const isNewPB = outcome === 'complete' ? summary?.isNewPB ?? false : false;

  const rows = useMemo(
    () => buildSplitRows(thisRunSplits, referenceSplits),
    [thisRunSplits, referenceSplits],
  );

  const thisFairness = useMemo(() => {
    const map = getActiveMap();
    return buildGhostHydroFairness({
      launchHour: getActiveLaunchHour(),
      events: parseHydroEvents(map.levelData.hydroEvents),
      qualityPreset: getQualityPresetNow(),
    });
  }, [mapId]);

  const rivalFairness = rival ? fairnessFromGhostFile(rival) : null;
  const fairnessNote = describeHydroFairnessMismatch(thisFairness, rivalFairness, 'rival');
  const hydroBlame = describeHydroSplitBlame(
    rows,
    parseHydroEvents(getActiveMap().levelData.hydroEvents),
    thisFairness.launchHour ?? 0,
  );

  if (thisRunSplits.length === 0) return null;

  const handleExport = () => {
    const payload = getCurrentGhostPayload();
    if (!payload) return;
    const timeMs = thisRunTimeMs ?? getGhostElapsedMs();
    downloadGhostFile(mapId, timeMs, payload, thisRunSplits, undefined, thisFairness);
  };

  const handleCopySplits = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    const text = splitsAsText(mapId, thisRunTimeMs ?? 0, rows);
    navigator.clipboard.writeText(text).then(
      () => {
        setCopyStatus('copied');
        window.setTimeout(() => setCopyStatus('idle'), 1500);
      },
      () => {},
    );
  };

  return (
    <div className="run-results-panel">
      <div className="run-results-panel__times">
        <div className="run-results-panel__time-cell">
          <div className="run-results-panel__time-label">
            {outcome === 'wipeout' ? 'DNF AT' : 'THIS RUN'}
          </div>
          <div className="run-results-panel__time-value">
            {thisRunTimeMs !== null
              ? formatRaceTimeMs(thisRunTimeMs)
              : formatRaceTimeMs(getGhostElapsedMs())}
          </div>
          {isNewPB && <div className="run-results-panel__pb-badge">NEW PB</div>}
        </div>

        <div className="run-results-panel__time-cell run-results-panel__time-cell--pb">
          <div className="run-results-panel__time-label">PB</div>
          <div className="run-results-panel__time-value">
            {referenceTimeMs !== undefined ? formatRaceTimeMs(referenceTimeMs) : '—'}
          </div>
        </div>

        {rival && (
          <div className="run-results-panel__time-cell run-results-panel__time-cell--rival">
            <div className="run-results-panel__time-label">RIVAL</div>
            <div className="run-results-panel__time-value">{formatRaceTimeMs(rival.timeMs)}</div>
          </div>
        )}
      </div>

      {(fairnessNote || hydroBlame) && (
        <div className="run-results-panel__fairness">
          {fairnessNote && <div>{fairnessNote}</div>}
          {hydroBlame && <div>{hydroBlame}</div>}
        </div>
      )}

      <div className="run-results-panel__splits">
        {rows.map((row) => (
          <div
            key={row.segmentIndex}
            className={`run-results-panel__split-row run-results-panel__split-row--${row.tier}`}
          >
            <span className="run-results-panel__split-seg">SEG {row.segmentIndex}</span>
            <span className="run-results-panel__split-time">{formatRaceTimeMs(row.tMs)}</span>
            <span className="run-results-panel__split-delta">
              {row.deltaMs === null ? '—' : formatSignedMs(row.deltaMs)}
            </span>
          </div>
        ))}
        {outcome === 'wipeout' && (
          <div className="run-results-panel__split-row run-results-panel__split-row--dnf">
            <span className="run-results-panel__split-seg">DNF</span>
            <span className="run-results-panel__split-time run-results-panel__split-time--wide">
              wipeout after checkpoint {rows[rows.length - 1]?.segmentIndex ?? '—'}
            </span>
          </div>
        )}
      </div>

      <div className="run-results-panel__actions">
        <button type="button" className="run-results-panel__action-btn" onClick={handleExport}>
          EXPORT .WSGHOST
        </button>
        <button type="button" className="run-results-panel__action-btn" onClick={handleCopySplits}>
          {copyStatus === 'copied' ? 'COPIED!' : 'COPY SPLITS'}
        </button>
      </div>
    </div>
  );
}
