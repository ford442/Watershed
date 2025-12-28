import React, { useState, useEffect } from 'react';
import { useProgress } from '@react-three/drei';

export const Loader = () => {
  const { progress, active, item } = useProgress();
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (!active && progress === 100) {
      const timer = setTimeout(() => setFinished(true), 500);
      return () => clearTimeout(timer);
    }
    if (active) {
      setFinished(false);
    }
  }, [active, progress]);

  if (finished) return null;

  const isFading = !active && progress === 100;

  return (
    <div className={`loader-overlay ${isFading ? 'fade-out' : ''}`}>
      <div className="loader-content">
        <div className="loader-header">SYSTEM INITIALIZATION</div>
        <div className="loader-text" aria-live="polite">LOADING ASSETS... {Math.round(progress)}%</div>
        <div
          className="loader-bar"
          role="progressbar"
          aria-label="Asset loading progress"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="loader-bar-fill" style={{ width: `${progress}%` }} />
        </div>
        {item && <div className="loader-item">PROCESSING: {item}</div>}
      </div>
    </div>
  );
};
