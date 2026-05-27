// src/components/GameHUD.tsx
// Heads-up display: speed, distance, biome, momentum, wipeout

import React, { useEffect, useState } from 'react';
import { usePlayerBiome, useGameStore } from '../systems/GameState';

interface GameHUDProps {
  /** Wipeout trigger */
  isWipeout?: boolean;
  /** Respawn callback */
  onRespawn?: () => void;
  /** Best distance from localStorage (optional) */
  initialBestDistance?: number;
}

/** Biome display names and accent colors — keyed by canonical BiomePalette id */
const BIOME_STYLES: Record<string, { name: string; color: string; bg: string }> = {
  canyonSummer:  { name: 'Canyon Summer',  color: '#4ade80', bg: 'rgba(74,222,128,0.15)' },
  canyonAutumn:  { name: 'Canyon Autumn',  color: '#fb923c', bg: 'rgba(251,146,60,0.15)' },
  alpineSpring:  { name: 'Alpine Spring',  color: '#93c5fd', bg: 'rgba(147,197,253,0.15)' },
  cavern:        { name: 'Mystic Cavern',  color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
  delta:         { name: 'River Delta',    color: '#34d399', bg: 'rgba(52,211,153,0.15)' },
  midnightMist:  { name: 'Midnight Mist',  color: '#818cf8', bg: 'rgba(129,140,248,0.15)' },
};

/**
 * GameHUD — Speedometer, distance counter, biome badge, momentum bar, and wipeout screen
 *
 * Features:
 * - Real-time speed display (km/h, game-scaled)
 * - Distance tracker (meters downstream)
 * - Biome name badge with seasonal color
 * - "Water Shed %" momentum bar (velocity-based)
 * - Best distance persistence
 * - Wipeout screen with respawn
 */
export const GameHUD: React.FC<GameHUDProps> = ({
  isWipeout = false,
  onRespawn,
  initialBestDistance = 0,
}) => {
  const [bestDistance, setBestDistance] = useState(initialBestDistance);
  const [showShaderHint, setShowShaderHint] = useState(true);

  const currentBiome = usePlayerBiome();
  const biomeStyle = BIOME_STYLES[currentBiome] ?? BIOME_STYLES.canyonSummer;

  // Read speed and distance from the Zustand store (updated by InnerExperience.useFrame
  // inside Canvas, avoiding R3F hook usage inside the <Html> portal).
  const rawSpeed = useGameStore((s) => s.currentSpeed);
  const distance = useGameStore((s) => s.distanceTraveled);

  const speed = Math.max(0, Math.round(rawSpeed * 12));
  const momentum = Math.min(100, Math.round((rawSpeed / 25) * 100));

  // Load best distance from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('watershed_best_distance');
    if (saved) {
      setBestDistance(parseInt(saved, 10));
    }
  }, []);

  // Save best distance when surpassed
  useEffect(() => {
    if (distance > bestDistance) {
      setBestDistance(distance);
      localStorage.setItem('watershed_best_distance', distance.toString());
    }
  }, [distance, bestDistance]);

  // Hide shader hint after 10 seconds
  useEffect(() => {
    const timer = setTimeout(() => setShowShaderHint(false), 10000);
    return () => clearTimeout(timer);
  }, []);

  // Wipeout screen
  if (isWipeout) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
        <div className="text-center animate-in fade-in zoom-in duration-300">
          <div className="text-7xl md:text-9xl font-black text-red-500 mb-6 tracking-tighter">
            WIPEOUT
          </div>

          <div className="text-2xl md:text-4xl text-white mb-4">
            Distance: <span className="font-mono font-bold">{distance}m</span>
          </div>

          {distance >= bestDistance && distance > 0 && (
            <div className="text-emerald-400 text-xl md:text-2xl mb-8 font-bold">
              🎉 NEW BEST!
            </div>
          )}

          <div className="text-zinc-500 text-lg mb-12">
            Best: <span className="font-mono text-emerald-400">{bestDistance}m</span>
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

  return (
    <>
      {/* Top-left: Speedometer + Momentum */}
      <div className="fixed top-4 left-4 md:top-6 md:left-6 bg-black/60 backdrop-blur-md text-white px-4 py-3 md:px-6 md:py-4 rounded-2xl border border-white/10 shadow-lg min-w-[180px]">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-4xl md:text-5xl font-bold text-emerald-400">
            {speed}
          </span>
          <span className="text-sm md:text-base text-white/60 font-medium">
            km/h
          </span>
        </div>
        <div className="mt-1 h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all duration-150"
            style={{ width: `${Math.min(100, (speed / 80) * 100)}%` }}
          />
        </div>

        {/* Water Shed % Momentum Bar (Goal 4) */}
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="flex items-center justify-between text-xs text-white/50 mb-1">
            <span>Water Shed</span>
            <span className="font-mono text-sky-400">{momentum}%</span>
          </div>
          <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-sky-600 to-sky-300 transition-all duration-150"
              style={{ width: `${momentum}%` }}
            />
          </div>
        </div>
      </div>

      {/* Top-center: Biome Badge (Goal 4) */}
      <div
        className="fixed top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full border shadow-lg backdrop-blur-md text-sm font-semibold tracking-wide uppercase transition-colors duration-500"
        style={{
          color: biomeStyle.color,
          borderColor: biomeStyle.color,
          background: biomeStyle.bg,
        }}
      >
        {biomeStyle.name}
      </div>

      {/* Top-right: Distance */}
      <div className="fixed top-4 right-4 md:top-6 md:right-6 bg-black/60 backdrop-blur-md text-white px-4 py-3 md:px-6 md:py-4 rounded-2xl border border-white/10 shadow-lg text-right">
        <div className="text-xs md:text-sm text-white/50 font-medium uppercase tracking-wider">
          Distance
        </div>
        <div className="flex items-baseline justify-end gap-1">
          <span className="font-mono text-3xl md:text-4xl font-bold">
            {distance}
          </span>
          <span className="text-white/60">m</span>
        </div>
        {distance > 0 && distance >= bestDistance && (
          <div className="text-emerald-400 text-xs mt-1">
            New Best!
          </div>
        )}
      </div>

      {/* Bottom-left: Shader browser hint */}
      {showShaderHint && (
        <div className="fixed bottom-4 left-4 md:bottom-6 md:left-6 text-white/40 text-xs md:text-sm font-mono animate-pulse"
        >
          <span className="bg-white/10 px-2 py-1 rounded">TAB</span>
          <span className="mx-1">or</span>
          <span className="bg-white/10 px-2 py-1 rounded">P</span>
          <span className="ml-2">Shader Gallery</span>
        </div>
      )}

      {/* Bottom-right: Best distance (always visible) */}
      {bestDistance > 0 && (
        <div className="fixed bottom-4 right-4 md:bottom-6 md:right-6 text-white/40 text-xs md:text-sm font-mono"
        >
          Best: <span className="text-emerald-400">{bestDistance}m</span>
        </div>
      )}
    </>
  );
};

export default GameHUD;
