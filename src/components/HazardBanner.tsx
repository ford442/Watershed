/**
 * HazardBanner.tsx — the hazard up ahead, as a shape, a word and a countdown (#578 A.2).
 *
 * Mounted (lazily, by GameHUD) only while a hazard is up. Shows the most urgent
 * one — active over telegraphing over armed — as `▲ Dam release in 6 s`: the
 * glyph (`TELEGRAPH_GLYPH`) and the words carry the warning on their own, and
 * the colour comes from the player's colour-vision palette (`--a11y-telegraph-*`,
 * the same keys the in-world band reads), so the #558 not-colour-alone rule
 * holds. The countdown is the sim clock's (hazardLive `secondsLeft`), so it
 * stops when the game pauses. Polled at 4 Hz; re-renders only when the line
 * changes.
 */
import React, { useEffect, useState } from 'react';
import { getLiveHazards, type LiveHazard, type LiveHazardPhase } from '../systems/hazards/hazardLive';
import { TELEGRAPH_GLYPH } from '../systems/settings/access';
import { useT } from '../i18n/useT';
import { registerEnglish, type MessageKey } from '../i18n/i18n';
import { hazards } from '../i18n/en/lazy/hazards';

// This chunk's English rides with it, not the entry.
registerEnglish(hazards);

const POLL_MS = 250;
const URGENCY: Record<LiveHazardPhase, number> = { armed: 0, telegraph: 1, active: 2 };

interface Line {
  kind: LiveHazard['kind'];
  phase: LiveHazardPhase;
  /** Whole seconds left, rounded up (the telegraph's countdown). */
  seconds: number;
}

/** The most urgent hazard up, or null. */
export function headlineHazard(list: readonly LiveHazard[]): Line | null {
  let best: LiveHazard | null = null;
  for (const hazard of list) {
    if (!best || URGENCY[hazard.phase] > URGENCY[best.phase]) best = hazard;
  }
  if (!best) return null;
  return { kind: best.kind, phase: best.phase, seconds: Math.max(0, Math.ceil(best.secondsLeft ?? 0)) };
}

const same = (a: Line | null, b: Line | null) =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.phase === b.phase && a.seconds === b.seconds);

export default function HazardBanner(): React.ReactElement | null {
  const t = useT();
  const [line, setLine] = useState<Line | null>(() => headlineHazard(getLiveHazards()));

  useEffect(() => {
    const id = window.setInterval(() => {
      const next = headlineHazard(getLiveHazards());
      setLine((prev) => (same(prev, next) ? prev : next));
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  if (!line) return null;
  // A table of keys, some with `{seconds}`: the typed t cannot see which.
  const say = t as unknown as (key: MessageKey, params?: Record<string, number>) => string;
  const text = say(`hazard.${line.kind}.${line.phase}` as MessageKey, { seconds: line.seconds });
  return (
    <div
      className="hazard-banner"
      role="group"
      aria-label={t('hazard.region')}
      data-phase={line.phase}
      data-testid="hazard-banner"
    >
      <span className="hazard-banner-glyph" aria-hidden="true">
        {TELEGRAPH_GLYPH[line.phase]}
      </span>
      <span className="hazard-banner-text">{text}</span>
    </div>
  );
}
