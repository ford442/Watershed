/**
 * GhostFairnessBanner.tsx — "you are racing 14:00 lumber" (#438 E1).
 *
 * Shown for a few seconds at run start and on every resume, only when there
 * is a ghost to talk about. A PB or rival ghost from a different launch hour
 * or hydro event set is hidden by GhostReplayer; this banner is where the
 * player learns why instead of the ghost silently vanishing.
 */

import { useEffect, useState } from 'react';
import { useGameStore } from '../systems/GameState';
import { getActiveMapId } from '../utils/runContext';
import { currentRunFairness, judgeStoredPB, judgeStoredRival } from '../systems/ghost/raceFairness';
import { formatLaunchHour } from '../systems/ghost/hydroFairness';

const VISIBLE_MS = 6000;

interface GhostFairnessBannerProps {
  mapLabel: string;
}

export default function GhostFairnessBanner({ mapLabel }: GhostFairnessBannerProps) {
  const isPaused = useGameStore((s) => s.isPaused);
  const ghostEnabled = useGameStore((s) => s.ghostEnabled);
  const [visible, setVisible] = useState(true);
  const [resetTick, setResetTick] = useState(0);

  useEffect(() => {
    const onReset = () => setResetTick((n) => n + 1);
    window.addEventListener('watershed-run-reset', onReset);
    return () => window.removeEventListener('watershed-run-reset', onReset);
  }, []);

  useEffect(() => {
    if (isPaused) return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [isPaused, resetTick]);

  if (!visible || isPaused || !ghostEnabled) return null;

  const mapId = getActiveMapId();
  const pb = judgeStoredPB(mapId);
  const rival = judgeStoredRival(mapId);
  if (!pb && !rival) return null;

  const hour = currentRunFairness(mapId).launchHour ?? 0;
  const notes: string[] = [];
  if (pb?.kind === 'refused') notes.push(`${pb.message} — ghost hidden`);
  if (rival?.verdict.kind === 'refused') notes.push(`${rival.verdict.message} — rival hidden`);
  else if (rival?.verdict.kind === 'unverified') notes.push(rival.verdict.message);

  return (
    <div className="ghost-fairness-banner" role="status" data-testid="ghost-fairness-banner">
      <div className="ghost-fairness-banner__title">
        RACING {formatLaunchHour(hour)} {mapLabel.toUpperCase()}
      </div>
      {notes.map((note) => (
        <div key={note} className="ghost-fairness-banner__note">
          {note}
        </div>
      ))}
    </div>
  );
}
