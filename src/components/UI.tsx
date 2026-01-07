import React, { useState, useEffect, useRef } from 'react';
import { useProgress } from '@react-three/drei';

export const UI = () => {
  const { active, progress } = useProgress();
  const isLoading = active || progress < 100;
  const [locked, setLocked] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const buttonRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleLockChange = () => {
      const isLocked = !!document.pointerLockElement;
      setLocked(isLocked);
      if (isLocked) {
        setHasStarted(true);
        // Show hint 2 seconds after starting
        setTimeout(() => {
          setShowHint(true);
          // Hide hint after 5 seconds
          setTimeout(() => setShowHint(false), 5000);
        }, 2000);
      } else {
        setShowHint(false);
        // Clear active keys when game starts to prevent stuck visuals
        setActiveKeys(new Set());
      }
    };

    document.addEventListener('pointerlockchange', handleLockChange);
    // Check initial state
    setLocked(!!document.pointerLockElement);

    return () => document.removeEventListener('pointerlockchange', handleLockChange);
  }, []);

  useEffect(() => {
    const handleKeyActivity = (e: KeyboardEvent, isDown: boolean) => {
      // Don't track keys if game is locked (playing)
      if (locked) return;

      setActiveKeys(prev => {
        const next = new Set(prev);
        if (isDown) next.add(e.code);
        else next.delete(e.code);
        return next;
      });
    };

    const handleMouseActivity = (e: MouseEvent, isDown: boolean) => {
      if (locked) return;

      if (e.button === 2) { // Right Click
        setActiveKeys(prev => {
          const next = new Set(prev);
          if (isDown) next.add('MouseRight');
          else next.delete('MouseRight');
          return next;
        });
      }
    };

    const onKeyDown = (e: KeyboardEvent) => handleKeyActivity(e, true);
    const onKeyUp = (e: KeyboardEvent) => handleKeyActivity(e, false);
    const onMouseDown = (e: MouseEvent) => handleMouseActivity(e, true);
    const onMouseUp = (e: MouseEvent) => handleMouseActivity(e, false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [locked]);

  const getKeyClass = (codes: string[], baseClass = 'key') => {
    const isActive = codes.some(code => activeKeys.has(code));
    return `${baseClass} ${isActive ? 'pressed' : ''}`;
  };

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
      if (confirmRestart) {
        confirmRef.current?.focus();
      } else {
        buttonRef.current?.focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent starting if loading is active
      if (!locked && !isLoading) {
        if (confirmRestart) {
          if (e.key === 'Escape') {
            e.preventDefault();
            setConfirmRestart(false);
          }
          // Don't handle Enter here if confirming restart,
          // let the focused button handle it natively.
          return;
        }

        // Shortcut to trigger restart confirmation
        if ((e.key === 'r' || e.key === 'R') && hasStarted && !locked && !confirmRestart) {
          setConfirmRestart(true);
        }

        if (e.key === 'Enter') {
          // If focus is on an interactive element (like the Restart button), don't hijack Enter
          if (document.activeElement instanceof HTMLButtonElement) {
            return;
          }
          e.preventDefault();
          handleStart();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [locked, isLoading, confirmRestart, hasStarted]);

  return (
    <>
      <div className={`crosshair ${locked ? 'visible' : 'hidden'}`} data-testid="crosshair" />

      <div
        className={`game-hint ${showHint && locked ? 'visible' : 'hidden'}`}
        role="status"
        aria-live="polite"
      >
        PRESS SPACE TO JUMP
      </div>

      <div
        className={`ui-overlay ${!locked ? 'visible' : 'hidden'}`}
        aria-hidden={locked}
        aria-modal={!locked}
        style={isLoading ? { cursor: 'wait' } : {}}
      >
        <div className="ui-card">
          <h1>WATERSHED</h1>
        {hasStarted && <div className="loader-text" role="status">GAME PAUSED</div>}
        <div className="button-group">
          {!confirmRestart ? (
            <>
              <button
                ref={buttonRef}
                className="start-button start-prompt"
                onClick={handleStart}
                disabled={isLoading}
                style={isLoading ? { opacity: 0.5, cursor: 'wait' } : {}}
                aria-label={hasStarted ? "Resume Game - Click or Press Enter" : "Start Game - Click or Press Enter to engage pointer lock"}
                aria-keyshortcuts="Enter"
              >
                {hasStarted ? <>RESUME GAME <span className="mini-key" aria-hidden="true">ENTER</span></> : (isLoading ? "LOADING..." : "CLICK TO ENGAGE / PRESS ENTER")}
              </button>

              {hasStarted && (
                <button
                  className="restart-button"
                  onClick={() => setConfirmRestart(true)}
                  aria-label="Restart Game (Press R) - Opens confirmation to reload the page"
                  aria-keyshortcuts="r"
                >
                  RESTART <span className="mini-key" aria-hidden="true">R</span>
                </button>
              )}
            </>
          ) : (
            <div className="confirm-group" role="alertdialog" aria-live="assertive" aria-labelledby="confirm-label" aria-describedby="confirm-desc">
              <div id="confirm-label" className="confirm-text">RESTART GAME?</div>
              <div id="confirm-desc" className="confirm-subtext">PROGRESS WILL BE LOST</div>
              <div className="confirm-buttons">
                <button
                  ref={confirmRef}
                  className="confirm-yes"
                  onClick={handleRestart}
                  aria-label="Yes, Restart Game"
                  aria-keyshortcuts="Enter"
                >
                  YES
                </button>
                <button
                  className="confirm-no"
                  onClick={() => setConfirmRestart(false)}
                  aria-label="No, Cancel Restart"
                  aria-keyshortcuts="Escape"
                >
                  NO
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="controls-section" role="list" aria-label="Game Controls">
          <div className="control-row" role="listitem" aria-label="Move: A, S, D, Arrow keys, or Right Click">
            <div className="keys" aria-hidden="true">
              <span className={getKeyClass(['KeyA', 'ArrowLeft'])}>A</span>
              <span className={getKeyClass(['KeyS', 'ArrowDown'])}>S</span>
              <span className={getKeyClass(['KeyD', 'ArrowRight'])}>D</span>
              <span className={getKeyClass(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], 'key key-wide')}>ARROWS</span>
              <span className={getKeyClass(['MouseRight'], 'key key-wide')}>R-CLICK</span>
            </div>
            <span className="action" aria-hidden="true">MOVE</span>
          </div>
          <div className="control-row" role="listitem" aria-label="Jump: W or Space key">
            <div className="keys" aria-hidden="true">
              <span className={getKeyClass(['KeyW'])}>W</span>
              <span className={getKeyClass(['Space'], 'key key-wide')}>SPACE</span>
            </div>
            <span className="action" aria-hidden="true">JUMP</span>
          </div>
          <div className="control-row" role="listitem" aria-label="Look: Mouse movement">
            <div className="keys" aria-hidden="true">
              <span className="key key-wide">MOUSE</span>
            </div>
            <span className="action" aria-hidden="true">LOOK</span>
          </div>
          <div className="control-row" role="listitem" aria-label="Pause: Escape key">
            <div className="keys" aria-hidden="true">
              <span className={getKeyClass(['Escape'], 'key key-wide')}>ESC</span>
            </div>
            <span className="action" aria-hidden="true">PAUSE</span>
          </div>
        </div>
      </div>
    </div>
    </>
  );
};
