import React, { useState, useEffect } from 'react';
import { useProgress } from '@react-three/drei';

export const Loader = () => {
  const { progress, active, item, total } = useProgress();
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    // If progress is 100% OR active is false (finished loading or nothing to load), hide loader
    if (!active && (progress === 100 || total === 0)) {
      const timer = setTimeout(() => setFinished(true), 500);
      return () => clearTimeout(timer);
    }
    if (active) {
      setFinished(false);
    }
  }, [active, progress, total]);

  if (finished) return null;

  // Fade out if finished loading
  const isFading = !active && (progress === 100 || total === 0);

  // Show 100% if total is 0 to avoid "0%" confusion
  const displayProgress = total === 0 ? 100 : Math.round(progress);

  return (
    <div className={`loader-overlay ${isFading ? 'fade-out' : ''}`}>
      <div className="loader-content">
        <div className="loader-header">SYSTEM INITIALIZATION</div>
        <div className="loader-text" aria-live="polite">LOADING ASSETS... {displayProgress}%</div>
        <div
          className="loader-bar"
          role="progressbar"
          aria-label="Asset loading progress"
          aria-valuenow={displayProgress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="loader-bar-fill" style={{ width: `${displayProgress}%` }} />
        </div>
        {item && <div className="loader-item">PROCESSING: {item}</div>}
      </div>
    </div>
  );
};
