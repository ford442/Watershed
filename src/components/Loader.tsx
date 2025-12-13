import React from 'react';
import { useProgress } from '@react-three/drei';

export const Loader = () => {
  const { progress, active, item } = useProgress();

  // If not active and progress is complete, don't render
  // We check progress === 100 to ensure we don't hide prematurely if active is briefly false
  if (!active && progress === 100) return null;

  return (
    <div className="loader-overlay">
      <div className="loader-content">
        <div className="loader-header">SYSTEM INITIALIZATION</div>
        <div className="loader-text">LOADING ASSETS... {Math.round(progress)}%</div>
        <div className="loader-bar">
          <div className="loader-bar-fill" style={{ width: `${progress}%` }} />
        </div>
        {item && <div className="loader-item">PROCESSING: {item}</div>}
      </div>
    </div>
  );
};
