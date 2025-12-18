import React, { useState, useEffect, useRef } from 'react';

export const UI = () => {
  const [locked, setLocked] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleLockChange = () => {
      setLocked(!!document.pointerLockElement);
    };

    document.addEventListener('pointerlockchange', handleLockChange);
    // Check initial state
    setLocked(!!document.pointerLockElement);

    return () => document.removeEventListener('pointerlockchange', handleLockChange);
  }, []);

  const handleStart = () => {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.requestPointerLock();
    }
  };

  useEffect(() => {
    if (!locked) {
      buttonRef.current?.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!locked && e.key === 'Enter') {
        e.preventDefault();
        handleStart();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [locked]);

  if (locked) {
    return <div className="crosshair" data-testid="crosshair" />;
  }

  return (
    <div className="ui-overlay">
      <div className="ui-card">
        <h1>WATERSHED</h1>
        <button
          ref={buttonRef}
          className="start-button start-prompt"
          onClick={handleStart}
          aria-label="Start Game - Click or Press Enter to engage pointer lock"
        >
          CLICK TO ENGAGE / PRESS ENTER
        </button>

        <div className="controls-section" role="list" aria-label="Game Controls">
          <div className="control-row" role="listitem" aria-label="Move: A, S, D, Arrow keys, or Right Click">
            <div className="keys" aria-hidden="true">
              <span className="key">A</span>
              <span className="key">S</span>
              <span className="key">D</span>
              <span className="key key-wide">ARROWS</span>
              <span className="key key-wide">R-CLICK</span>
            </div>
            <span className="action" aria-hidden="true">MOVE</span>
          </div>
          <div className="control-row" role="listitem" aria-label="Jump: W or Space key">
            <div className="keys" aria-hidden="true">
              <span className="key">W</span>
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
