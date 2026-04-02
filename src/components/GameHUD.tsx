// src/components/GameHUD.tsx
// Heads-up display: speed, distance, wipeout

import React, { useEffect, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface GameHUDProps {
  /** Rapier rigid body ref for velocity/position */
  rigidBodyRef: React.MutableRefObject<any>;
  /** Wipeout trigger */
  isWipeout?: boolean;
  /** Respawn callback */
  onRespawn?: () => void;
  /** Best distance from localStorage (optional) */
  initialBestDistance?: number;
}

/**
 * GameHUD — Speedometer, distance counter, and wipeout screen
 * 
 * Features:
 * - Real-time speed display (km/h, game-scaled)
 * - Distance tracker (meters downstream)
 * - Best distance persistence
 * - Wipeout screen with respawn
 * - Shader browser hint
 */
export const GameHUD: React.FC<GameHUDProps> = ({
  rigidBodyRef,
  isWipeout = false,
  onRespawn,
  initialBestDistance = 0,
}) => {
  const [speed, setSpeed] = useState(0);
  const [distance, setDistance] = useState(0);
  const [bestDistance, setBestDistance] = useState(initialBestDistance);
  const [showShaderHint, setShowShaderHint] = useState(true);

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

  // Update speed and distance every frame
  useFrame(() => {
    if (!rigidBodyRef.current || isWipeout) return;

    const rb = rigidBodyRef.current;
    const vel = rb.linvel();
    const pos = rb.translation();

    // Calculate speed in km/h (arbitrary scale for "fun" numbers)
    // Adjust multiplier (12) to get desired speed feel
    const rawSpeed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    const kmh = Math.round(rawSpeed * 12);
    setSpeed(Math.max(0, kmh));

    // Distance = how far downstream (negative Z is forward)
    const downstream = Math.abs(pos.z);
    const meters = Math.floor(downstream * 0.5); // Scale world units to meters
    setDistance(meters);
  });

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
      {/* Top-left: Speedometer */}
      <div className="fixed top-4 left-4 md:top-6 md:left-6 bg-black/60 backdrop-blur-md text-white px-4 py-3 md:px-6 md:py-4 rounded-2xl border border-white/10 shadow-lg">
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
