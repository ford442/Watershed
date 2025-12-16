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

  if (locked) {
    return <div className="crosshair" data-testid="crosshair" />;
  }

  const handleStart = () => {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.requestPointerLock();
    }
  };

  return (
    <div className="ui-overlay">
      <div className="ui-card">
        <h1>WATERSHED</h1>
        <button
          className="start-button start-prompt"
          onClick={handleStart}
          aria-label="Start Game - Click to engage pointer lock"
        >
          CLICK TO ENGAGE
        </button>

        <div className="controls-section" role="list" aria-label="Game Controls">
          <div className="control-row" role="listitem" aria-label="Move: W, A, S, D keys">
            <div className="keys" aria-hidden="true">
              <span className="key">W</span>
              <span className="key">A</span>
              <span className="key">S</span>
              <span className="key">D</span>
            </div>
            <span className="action" aria-hidden="true">MOVE</span>
          </div>
          <div className="control-row" role="listitem" aria-label="Jump: Space key">
            <div className="keys" aria-hidden="true">
              <span className="key key-wide">SPACE</span>
            </div>
            <span className="action" aria-hidden="true">JUMP</span>
          </div>
          <div className="control-row" role="listitem" aria-label="Look: Mouse movement">
            <div className="keys" aria-hidden="true">
              <span className="key key-wide">MOUSE</span>
            </div>
            <span className="action" aria-hidden="true">LOOK</span>
          </div>
        </div>
      </div>
    </div>
  );
};
