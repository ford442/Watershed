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
import { getActiveMapId, getActiveRunKey, getProceduralBaseSeed } from '../utils/runContext';
import { useGameStore } from '../systems/GameState';
import { getActiveConditions } from '../systems/journey/runSession';
import { getRecordedHazardLog } from '../systems/hazards/hazardLog';
import { getRunBest } from '../systems/persistence/PersistenceSystem';
import { getRecordedSplits } from '../systems/ghost/SplitRecorder';
import { getGhostElapsedMs, getCurrentGhostPayload } from '../systems/ghost/GhostRecorder';
import { getLastFinishSummary } from '../systems/ghost/runFinish';
import {
  buildGhostShareUrl,
  downloadGhostFile,
  ghostShareFilename,
} from '../systems/ghost/ghostExport';
import { formatRaceTimeMs } from '../systems/ghost/raceTimeFormat';
import type { RunSplitEntry } from '../systems/ghost/ghostCodec';
import {
  fairnessFromGhostFile,
  hydroFairnessMismatch,
  hydroSplitBlame,
  shortHydroHash,
  type HydroFairnessDiff,
} from '../systems/ghost/hydroFairness';
import { currentRunFairness, hydroEventsForMap, judgeStoredRival } from '../systems/ghost/raceFairness';
import { getRunAssistBits } from '../systems/settings/accessRuntime';
import { useT } from '../i18n/useT';
import type { TFunction } from '../i18n/i18n';
import { formatFixed, formatLaunchHour } from '../i18n/format';
import { registerEnglish } from '../i18n/i18n';
import { runResults } from '../i18n/en/lazy/runResults';

// This chunk's English rides with it, not the entry (#566).
registerEnglish(runResults);

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

const SPLIT_TIER_GLYPH: Record<SplitRow['tier'], string> = { gold: '▼', green: '=', red: '▲', neutral: '' };

function formatSignedMs(deltaMs: number): string {
  const sign = deltaMs <= 0 ? '−' : '+';
  return `${sign}${formatRaceTimeMs(Math.abs(deltaMs))}`;
}

function splitsAsText(t: TFunction, mapId: string, timeMs: number, rows: SplitRow[]): string {
  const lines = [`${mapId} — ${formatRaceTimeMs(timeMs)}`];
  for (const row of rows) {
    const delta = row.deltaMs === null ? '' : `  (${formatSignedMs(row.deltaMs)})`;
    lines.push(`  ${t('results.seg', { index: String(row.segmentIndex) })}  ${formatRaceTimeMs(row.tMs)}${delta}`);
  }
  return lines.join('\n');
}

/** One clause per differing field, joined like the rest of the panel's meta lines. */
function describeMismatch(t: TFunction, diffs: HydroFairnessDiff[], label: string): string {
  if (diffs.length === 0) return t('results.differentRiver', { label });
  return diffs
    .map((diff) => {
      switch (diff.field) {
        case 'launch':
          return t('results.mismatchLaunch', {
            self: formatLaunchHour(diff.self),
            other: formatLaunchHour(diff.other),
            label,
          });
        case 'hydro':
          return t('results.mismatchHydro', { self: diff.self, other: diff.other, label });
        case 'quality':
          return t('results.mismatchQuality', { self: diff.self, other: diff.other, label });
      }
    })
    .join(' · ');
}

export default function RunResultsPanel({ outcome }: RunResultsPanelProps) {
  const t = useT();
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [linkStatus, setLinkStatus] = useState<'idle' | 'copied'>('idle');

  const mapId = useMemo(() => getActiveMapId(), []);
  const runKey = useMemo(() => getActiveRunKey(mapId), [mapId]);

  const summary = outcome === 'complete' ? getLastFinishSummary() : null;
  const pb = getRunBest(runKey);
  const judgedRival = judgeStoredRival(mapId);
  const rival = judgedRival?.file;
  const rivalRefusal = judgedRival?.verdict.kind === 'refused' ? judgedRival.verdict.message : null;

  const thisRunSplits = summary?.splits ?? getRecordedSplits();
  const thisRunTimeMs = summary?.timeMs ?? (outcome === 'complete' ? getGhostElapsedMs() : null);
  const referenceSplits = outcome === 'complete' ? summary?.previousSplits : pb.splits;
  const referenceTimeMs = outcome === 'complete' ? summary?.previousBestTimeMs : pb.bestTimeMs;
  const isNewPB = outcome === 'complete' ? summary?.isNewPB ?? false : false;

  const rows = useMemo(
    () => buildSplitRows(thisRunSplits, referenceSplits),
    [thisRunSplits, referenceSplits],
  );

  const thisFairness = useMemo(() => currentRunFairness(mapId), [mapId]);

  const rivalFairness = rival ? fairnessFromGhostFile(rival) : null;
  // A refused rival gets the refusal line instead of the softer mismatch note.
  const mismatch = rivalRefusal ? null : hydroFairnessMismatch(thisFairness, rivalFairness);
  const fairnessNote = rivalRefusal
    ? t('results.rivalRefusedNote', { reason: rivalRefusal })
    : mismatch
      ? describeMismatch(t, mismatch, t('results.rivalWord'))
      : null;
  const blame = hydroSplitBlame(rows, hydroEventsForMap(mapId), thisFairness.launchHour ?? 0);
  const hydroBlame = blame
    ? t('results.splitBlame', { seconds: formatFixed(blame.seconds, 1), event: blame.eventId })
    : null;

  const assists = getRunAssistBits();

  if (thisRunSplits.length === 0) return null;

  const handleExport = () => {
    const payload = getCurrentGhostPayload();
    if (!payload) return;
    const timeMs = thisRunTimeMs ?? getGhostElapsedMs();
    downloadGhostFile(
      mapId,
      timeMs,
      payload,
      thisRunSplits,
      ghostShareFilename(mapId, thisFairness.launchHour),
      thisFairness,
      // Enough to `?replay=` the run on its own river.
      {
        seed: getProceduralBaseSeed(),
        vehicle: useGameStore.getState().vehicleType,
        conditions: getActiveConditions(),
        hazards: getRecordedHazardLog(),
        assists,
      },
    );
  };

  const handleCopyLink = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof window === 'undefined') return;
    const url = buildGhostShareUrl(window.location, mapId, thisFairness.launchHour);
    navigator.clipboard.writeText(url).then(
      () => {
        setLinkStatus('copied');
        window.setTimeout(() => setLinkStatus('idle'), 1500);
      },
      () => {},
    );
  };

  const handleCopySplits = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    const text = splitsAsText(t, mapId, thisRunTimeMs ?? 0, rows);
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
            {outcome === 'wipeout' ? t('results.dnfAt') : t('results.thisRun')}
          </div>
          <div className="run-results-panel__time-value">
            {thisRunTimeMs !== null
              ? formatRaceTimeMs(thisRunTimeMs)
              : formatRaceTimeMs(getGhostElapsedMs())}
          </div>
          {isNewPB && <div className="run-results-panel__pb-badge">{t('results.newPb')}</div>}
        </div>

        <div className="run-results-panel__time-cell run-results-panel__time-cell--pb">
          <div className="run-results-panel__time-label">{t('results.pb')}</div>
          <div className="run-results-panel__time-value">
            {referenceTimeMs !== undefined ? formatRaceTimeMs(referenceTimeMs) : '—'}
          </div>
        </div>

        {rival && (
          <div className="run-results-panel__time-cell run-results-panel__time-cell--rival">
            <div className="run-results-panel__time-label">{rivalRefusal ? t('results.rivalRefused') : t('results.rival')}</div>
            <div className="run-results-panel__time-value">{formatRaceTimeMs(rival.timeMs)}</div>
          </div>
        )}
      </div>

      <div className="run-results-panel__river" data-testid="run-results-river">
        {t('results.riverLine', {
          hour: formatLaunchHour(thisFairness.launchHour ?? 0),
          map: mapId.toUpperCase(),
          hash: shortHydroHash(thisFairness.hydroEventHash),
          quality: thisFairness.qualityPreset ?? '',
        })}
      </div>

      {assists !== 0 && (
        <div className="run-results-panel__assisted" data-testid="results-assisted">
          {t('results.assisted')}
        </div>
      )}

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
            <span className="run-results-panel__split-seg">
              {t('results.seg', { index: String(row.segmentIndex) })}
            </span>
            <span className="run-results-panel__split-time">{formatRaceTimeMs(row.tMs)}</span>
            <span className="run-results-panel__split-delta">
              {/* Shape as well as colour (#558 C.1): ▼ faster, = even, ▲ slower. */}
              {row.deltaMs === null ? '—' : `${SPLIT_TIER_GLYPH[row.tier]} ${formatSignedMs(row.deltaMs)}`}
            </span>
          </div>
        ))}
        {outcome === 'wipeout' && (
          <div className="run-results-panel__split-row run-results-panel__split-row--dnf">
            <span className="run-results-panel__split-seg">{t('results.dnf')}</span>
            <span className="run-results-panel__split-time run-results-panel__split-time--wide">
              {t('results.wipeoutAfter', { index: String(rows[rows.length - 1]?.segmentIndex ?? '—') })}
            </span>
          </div>
        )}
      </div>

      <div className="run-results-panel__actions">
        <button type="button" className="run-results-panel__action-btn" onClick={handleExport}>
          {t('results.export')}
        </button>
        <button type="button" className="run-results-panel__action-btn" onClick={handleCopySplits}>
          {copyStatus === 'copied' ? t('results.copied') : t('results.copySplits')}
        </button>
        <button
          type="button"
          className="run-results-panel__action-btn"
          onClick={handleCopyLink}
          title={t('results.copyLinkTitle')}
        >
          {linkStatus === 'copied' ? t('results.linkCopied') : t('results.copyLink')}
        </button>
      </div>
    </div>
  );
}
