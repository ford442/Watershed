import React, { useEffect, useMemo, useState } from 'react';
import { usePlayerBiome, useGameStore } from '../systems/GameState';

interface GameHUDProps {
  isWipeout?: boolean;
  onRespawn?: () => void;
}

const BIOME_LABELS: Record<string, string> = {
  canyonSummer: 'CANYON SUMMER',
  canyonAutumn: 'CANYON AUTUMN',
  alpineSpring: 'ALPINE SPRING',
  cavern: 'MYSTIC CAVERN',
  delta: 'RIVER DELTA',
  midnightMist: 'MIDNIGHT MIST',
  slotCanyon: 'SLOT CANYON',
};

export const GameHUD: React.FC<GameHUDProps> = ({
  isWipeout = false,
  onRespawn,
}) => {
  const currentBiome = usePlayerBiome();
  const rawSpeed = useGameStore((s) => s.currentSpeed);
  const distanceMeters = useGameStore((s) => s.distance);
  const score = useGameStore((s) => s.score);
  const multiplier = useGameStore((s) => s.multiplier);
  const comboLabel = useGameStore((s) => s.comboLabel);
  const highScore = useGameStore((s) => s.highScore);
  const topSpeed = useGameStore((s) => s.topSpeed);
  const isJourneyComplete = useGameStore((s) => s.isJourneyComplete);

  const [comboFlash, setComboFlash] = useState('');
  const [overlayVisible, setOverlayVisible] = useState(false);

  const speedMs = Math.max(0, Math.round(rawSpeed));
  const distanceKm = useMemo(() => (distanceMeters / 1000).toFixed(2), [distanceMeters]);
  const biomeLabel = BIOME_LABELS[currentBiome] ?? 'CANYON SUMMER';

  useEffect(() => {
    if (!comboLabel) return;
    setComboFlash(comboLabel);
    const timeout = window.setTimeout(() => setComboFlash(''), 1200);
    return () => window.clearTimeout(timeout);
  }, [comboLabel]);

  useEffect(() => {
    if (isJourneyComplete) {
      const t = window.setTimeout(() => setOverlayVisible(true), 50);
      return () => window.clearTimeout(t);
    }
    setOverlayVisible(false);
  }, [isJourneyComplete]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isJourneyComplete && e.key === 'Enter') {
        useGameStore.getState().resetGameState();
        onRespawn?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isJourneyComplete, onRespawn]);

  if (isWipeout) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
        <div className="text-center animate-in fade-in zoom-in duration-300">
          <div className="text-7xl md:text-9xl font-black text-red-500 mb-6 tracking-tighter">
            WIPEOUT
          </div>

          <div className="text-2xl md:text-4xl text-white mb-2">
            Score: <span className="font-mono font-bold">{Math.floor(score).toLocaleString()}</span>
          </div>
          <div className="text-zinc-400 text-lg mb-8">
            High Score: <span className="font-mono text-emerald-400">{Math.floor(highScore).toLocaleString()}</span>
          </div>

          <button
            onClick={onRespawn}
            className="px-12 py-5 bg-white text-black text-2xl md:text-3xl font-black rounded-3xl hover:bg-emerald-400 hover:text-white hover:scale-105 transition-all shadow-2xl"
          >
            RESPAWN
          </button>

          <p className="mt-8 text-zinc-600 text-sm">
            Press SPACE to respawn
          </p>
        </div>
      </div>
    );
  }

  if (isJourneyComplete) {
    const isNewHighScore = score >= highScore && score > 0;
    return (
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm journey-complete-overlay ${overlayVisible ? 'visible' : ''}`}
      >
        <div className="text-center">
          <div className="text-5xl md:text-7xl font-black text-amber-300 mb-6 tracking-tighter">
            Journey Complete
          </div>

          <div className="text-3xl md:text-5xl text-white mb-4">
            <span className="font-mono font-bold">{Math.floor(score).toLocaleString()}</span>
          </div>

          <div className="text-lg md:text-xl mb-2">
            {isNewHighScore ? (
              <span className="text-emerald-400 font-bold">New High Score!</span>
            ) : (
              <span className="text-zinc-400">
                High Score: <span className="font-mono text-emerald-400">{Math.floor(highScore).toLocaleString()}</span>
              </span>
            )}
          </div>

          <div className="text-zinc-500 text-base mb-10">
            Top Speed: <span className="font-mono text-white">{Math.round(topSpeed)} m/s</span>
          </div>

          <button
            onClick={() => {
              useGameStore.getState().resetGameState();
              onRespawn?.();
            }}
            className="px-12 py-5 bg-white text-black text-2xl md:text-3xl font-black rounded-3xl hover:bg-emerald-400 hover:text-white hover:scale-105 transition-all shadow-2xl"
          >
            RESTART
          </button>

          <p className="mt-8 text-zinc-600 text-sm">
            Press Enter to restart
          </p>
        </div>
      </div>
    );
  }

  const multiplierColor = multiplier >= 7 ? '#ef4444' : multiplier >= 3 ? '#fbbf24' : '#f8fafc';

  return (
    <>
      <div className="fixed top-4 left-4 md:top-6 md:left-6 text-xs font-mono text-white/50 tracking-[0.12em]">
        {biomeLabel}
      </div>

      <div className="fixed top-4 right-4 md:top-6 md:right-6 bg-black/55 backdrop-blur-md text-right px-4 py-3 md:px-5 md:py-4 rounded-2xl border border-white/10 shadow-lg font-mono text-[#f5f1e8] min-w-[220px]">
        <div className="text-2xl md:text-3xl font-bold leading-none">{speedMs} <span className="text-sm text-white/60">m/s</span></div>
        <div className="mt-1 text-lg md:text-xl leading-none">{distanceKm} <span className="text-xs text-white/60">km</span></div>
        <div className="mt-3 text-xs uppercase tracking-wider text-white/50">Score</div>
        <div className="text-xl md:text-2xl font-bold leading-none">{Math.floor(score).toLocaleString()}</div>
      </div>

      {multiplier > 1 && (
        <div
          className="fixed top-10 left-1/2 -translate-x-1/2 font-mono font-black tracking-wider transition-opacity"
          style={{
            color: multiplierColor,
            fontSize: multiplier >= 7 ? '3rem' : '2.25rem',
            textShadow: multiplier >= 3 ? '0 0 18px rgba(251,191,36,0.35)' : '0 0 12px rgba(255,255,255,0.2)',
          }}
        >
          ×{multiplier}
        </div>
      )}

      {comboFlash && (
        <div
          className="fixed top-24 left-1/2 -translate-x-1/2 font-mono font-bold uppercase tracking-[0.16em] pointer-events-none"
          style={{
            color: '#fbbf24',
            fontSize: '1.1rem',
            textShadow: '0 0 12px rgba(251,191,36,0.6)',
          }}
        >
          {comboFlash}
        </div>
      )}

      <div className="fixed bottom-4 right-4 md:bottom-6 md:right-6 text-white/40 text-xs md:text-sm font-mono">
        Best: <span className="text-emerald-400">{Math.floor(highScore).toLocaleString()}</span>
        <span className="ml-4 text-white/50">Top {Math.round(topSpeed)} m/s</span>
      </div>
    </>
  );
};

export default GameHUD;
