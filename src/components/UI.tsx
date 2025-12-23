import React, { useState, useEffect, useRef } from 'react';
import { useProgress } from '@react-three/drei';

export const UI = () => {
  const { active, progress } = useProgress();
  const isLoading = active || progress < 100;
  const [locked, setLocked] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleLockChange = () => {
      const isLocked = !!document.pointerLockElement;
      setLocked(isLocked);
      if (isLocked) {
        setHasStarted(true);
      }
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

  const handleRestart = () => {
    window.location.reload();
  };

  useEffect(() => {
    // Only focus if not locked and not loading
    if (!locked && !isLoading) {
      buttonRef.current?.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent starting if loading is active
      if (!locked && !isLoading && e.key === 'Enter') {
        e.preventDefault();
        handleStart();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [locked, isLoading]);

  return (
    <>
      <div className={`crosshair ${locked ? 'visible' : 'hidden'}`} data-testid="crosshair" />
      <div
        className={`ui-overlay ${!locked ? 'visible' : 'hidden'}`}
        aria-hidden={locked}
      >
        <div className="ui-card">
          <h1>WATERSHED</h1>
        {hasStarted && <div className="loader-text">GAME PAUSED</div>}
        <div className="button-group">
          <button
            ref={buttonRef}
            className="start-button start-prompt"
            onClick={handleStart}
            disabled={isLoading}
            style={isLoading ? { opacity: 0.5, cursor: 'wait' } : {}}
            aria-label={hasStarted ? "Resume Game - Click or Press Enter" : "Start Game - Click or Press Enter to engage pointer lock"}
          >
            {hasStarted ? "RESUME GAME" : (isLoading ? "LOADING..." : "CLICK TO ENGAGE / PRESS ENTER")}
          </button>

          {hasStarted && (
            <button
              className="restart-button"
              onClick={handleRestart}
              aria-label="Restart Game - Reloads the page to start from the beginning"
            >
              RESTART
            </button>
          )}
        </div>

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
    </>
  );
};
