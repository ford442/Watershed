import React, { useState, useEffect } from 'react';

export const UI = () => {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const handleLockChange = () => {
      setLocked(!!document.pointerLockElement);
    };

    document.addEventListener('pointerlockchange', handleLockChange);
    // Check initial state
    setLocked(!!document.pointerLockElement);

    return () => document.removeEventListener('pointerlockchange', handleLockChange);
  }, []);

  if (locked) return null;

  return (
    <div className="ui-overlay">
      <div className="ui-card">
        <h1>WATERSHED</h1>
        <p className="start-prompt">CLICK TO ENGAGE</p>

        <div className="controls-section">
          <div className="control-row">
            <div className="keys">
              <span className="key">W</span>
              <span className="key">A</span>
              <span className="key">S</span>
              <span className="key">D</span>
            </div>
            <span className="action">MOVE</span>
          </div>
          <div className="control-row">
            <div className="keys">
              <span className="key key-wide">SPACE</span>
            </div>
            <span className="action">JUMP</span>
          </div>
          <div className="control-row">
            <div className="keys">
              <span className="key key-wide">MOUSE</span>
            </div>
            <span className="action">LOOK</span>
          </div>
        </div>
      </div>
    </div>
  );
};
