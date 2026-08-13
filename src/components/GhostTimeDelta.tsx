/**
 * GhostTimeDelta.tsx — HUD overlay showing time delta between the current run
 * and the personal-best ghost at the moment of a checkpoint or finish.
 *
 * Positive delta = behind PB (red). Negative = ahead of PB (green).
 */

import React, { useEffect, useRef, useState } from 'react';

export interface GhostTimeDeltaProps {
  /** Delta in seconds (current − PB). Positive = slower than PB. */
  deltaSeconds: number | null;
  /** When true the delta fades out after `displayDurationMs`. */
  autoHide?: boolean;
  displayDurationMs?: number;
  className?: string;
}

function formatDelta(seconds: number): string {
  const sign = seconds >= 0 ? '+' : '−';
  const abs = Math.abs(seconds);
  const mins = Math.floor(abs / 60);
  const secs = (abs % 60).toFixed(2).padStart(5, '0');
  return mins > 0 ? `${sign}${mins}:${secs}` : `${sign}${secs}`;
}

export const GhostTimeDelta: React.FC<GhostTimeDeltaProps> = ({
  deltaSeconds,
  autoHide = true,
  displayDurationMs = 3000,
  className,
}) => {
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
  const color = ahead ? '#4cff7c' : '#ff4c4c';

  return (
    <div
      className={className}
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
      aria-label={`Ghost time delta: ${formatDelta(deltaSeconds)}`}
    >
      {formatDelta(deltaSeconds)}
    </div>
  );
};

export default GhostTimeDelta;
