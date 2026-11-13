/**
 * GhostTimeDelta.tsx — HUD overlay showing time delta between the current run
 * and the personal-best ghost at the moment of a checkpoint or finish.
 *
 * Positive delta = behind PB, negative = ahead. The state is a colour from the
 * access palette *and* a shape and a word (▼ AHEAD / ▲ BEHIND, #558 C.1).
 */

import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/useT';
import { formatSplit } from '../i18n/format';

export interface GhostTimeDeltaProps {
  /** Delta in seconds (current − PB). Positive = slower than PB. */
  deltaSeconds: number | null;
  /** When true the delta fades out after `displayDurationMs`. */
  autoHide?: boolean;
  displayDurationMs?: number;
  className?: string;
}


export const GhostTimeDelta: React.FC<GhostTimeDeltaProps> = ({
  deltaSeconds,
  autoHide = true,
  displayDurationMs = 3000,
  className,
}) => {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (deltaSeconds === null) {
      setVisible(false);
      return;
    }
    setVisible(true);
    if (autoHide) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setVisible(false), displayDurationMs);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [deltaSeconds, autoHide, displayDurationMs]);

  if (!visible || deltaSeconds === null) return null;

  const ahead = deltaSeconds < 0;
  const color = ahead ? 'var(--a11y-ahead, #4cff7c)' : 'var(--a11y-behind, #ff4c4c)';
  const word = ahead ? t('hud.ghostAhead') : t('hud.ghostBehind');

  return (
    <div
      className={className}
      data-state={ahead ? 'ahead' : 'behind'}
      style={{
        position: 'fixed',
        top: '18%',
        left: '50%',
        transform: 'translateX(-50%)',
        fontFamily: 'monospace',
        fontSize: '1.6rem',
        fontWeight: 700,
        color,
        textShadow: '0 0 8px rgba(0,0,0,0.7)',
        pointerEvents: 'none',
        userSelect: 'none',
        letterSpacing: '0.05em',
      }}
      aria-live="polite"
      aria-label={t('hud.ghostDelta', { delta: formatSplit(deltaSeconds) })}
    >
      <span aria-hidden="true">{ahead ? '▼' : '▲'} </span>
      {formatSplit(deltaSeconds)}
      <span style={{ fontSize: '0.55em', marginLeft: '0.5em', letterSpacing: '0.12em' }}>{word}</span>
    </div>
  );
};

export default GhostTimeDelta;
