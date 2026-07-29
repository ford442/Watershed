import React, { useState, useEffect } from 'react';
import { useProgress } from '@react-three/drei';

export const Loader = () => {
  const { progress, active, item, total } = useProgress();
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (!active) {
      const timer = setTimeout(() => setFinished(true), 200);
      return () => clearTimeout(timer);
    }

    setFinished(false);
  }, [active]);

  if (finished) return null;

  // Fade out if finished loading
  // Match the logic above: if !active, start fading
  const isFading = !active;

  // Show 0% until progress reports; avoid a stuck "1%" idle flash
  const displayProgress = Math.round(progress);

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
