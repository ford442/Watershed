import React, { useEffect, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { useT } from '../i18n/useT';

export type GamePhase = 'menu' | 'playing' | 'paused';

export interface LoaderProps {
  gamePhase: GamePhase;
  canvasReady: boolean;
  worldEnabled: boolean;
}

const STUCK_TIMEOUT_MS = 20_000;
const READY_FLASH_MS = 900;

export const Loader = ({ gamePhase, canvasReady, worldEnabled }: LoaderProps) => {
  const t = useT();
  const { progress, active, item, errors } = useProgress();
  const [stuck, setStuck] = useState(false);
  const [readyFlash, setReadyFlash] = useState(false);
  const [bootDismissed, setBootDismissed] = useState(false);

  const bootReady = canvasReady && !active;
  const loadingWorld = worldEnabled && active && gamePhase !== 'menu';
  const booting = gamePhase === 'menu' && !bootReady && !bootDismissed;
  const visible = booting || loadingWorld || readyFlash;

  useEffect(() => {
    if (!active) {
      setStuck(false);
      return;
    }
    const timer = window.setTimeout(() => setStuck(true), STUCK_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    if (!bootReady || gamePhase !== 'menu' || bootDismissed || readyFlash) return;
    setReadyFlash(true);
    const timer = window.setTimeout(() => {
      setReadyFlash(false);
      setBootDismissed(true);
    }, READY_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [bootDismissed, bootReady, gamePhase, readyFlash]);

  useEffect(() => {
    if (gamePhase === 'menu') return;
    setBootDismissed(false);
  }, [gamePhase]);

  if (!visible) return null;

  const displayProgress = Math.round(progress);
  const isFading = readyFlash || (!active && !booting && !loadingWorld);

  // The progress number stays a plain integer: the messages carry the % sign.
  const progressText = String(displayProgress);
  let header = t('loader.init');
  let message = t('loader.assets', { progress: progressText });

  if (readyFlash) {
    header = t('loader.ready');
    message = t('loader.readyHint');
  } else if (!canvasReady) {
    header = t('loader.startup');
    message = t('loader.startupHint');
  } else if (loadingWorld) {
    header = t('loader.world');
    message = t('loader.worldHint', { progress: progressText });
  } else if (stuck) {
    header = t('loader.stuck');
    message = t('loader.stuckHint', { progress: progressText });
  }

  return (
    <div className={`loader-overlay ${isFading ? 'fade-out' : ''}`} data-testid="boot-loader">
      <div className="loader-content">
        <div className="loader-header">{header}</div>
        <div className="loader-text" aria-live="polite">
          {message}
        </div>
        {!readyFlash && (
          <div
            className="loader-bar"
            role="progressbar"
            aria-label={t('loader.progress')}
            aria-valuenow={displayProgress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="loader-bar-fill" style={{ width: `${displayProgress}%` }} />
          </div>
        )}
        {item && !readyFlash && <div className="loader-item">{t('loader.processing', { item })}</div>}
        {stuck && errors.length > 0 && (
          <div className="loader-item loader-item--warning">
            {t('loader.failed')}
          </div>
        )}
      </div>
    </div>
  );
};
