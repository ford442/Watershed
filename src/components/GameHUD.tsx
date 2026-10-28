import React, { useEffect, useRef, useState } from 'react';
import { usePlayerBiome, useGameStore, type GameStore } from '../systems/GameState';
import { getActiveLaunchAirSeconds } from '../systems/score/LaunchScoringSession';
import {
  getActiveLoadoutId,
  getActiveSurvivalModifiers,
  getActiveSurvivalState,
  getJourneyResultsSummary,
  getRunSession,
} from '../systems/journey/runSession';
import { getLoadoutDefinition } from '../systems/survival';
import { probeNativeStatus, type NativeStatus } from '../sim/nativeOwner';
import MovementReadout from './MovementReadout';
import MenuFocusScope from './MenuFocusScope';
import { lazyComponent } from '../utils/lazyComponent';
import { whenIdle } from '../utils/whenIdle';
import { BIOME_HUD_LABELS } from '../configs/biomes';

// The end-of-run summary only mounts on a wipeout / finish; the HUD preloads it at idle.
const RunResultsChunk = lazyComponent(() => import('./RunResultsPanel'));
const RunResultsPanel = RunResultsChunk.Component;

/*
 * Per-frame readouts (#465 C4). The store gets speed, distance and score every
 * frame; selecting the raw floats here reconciled the whole HUD at 60 Hz. Each
 * readout is a leaf that selects its *formatted* string, so only that text node
 * re-renders, and only when the visible text changes.
 */
type HudTextSelector = (s: GameStore) => string;
const selectSpeedText: HudTextSelector = (s) => String(Math.max(0, Math.round(s.currentSpeed)));
const selectDistanceKmText: HudTextSelector = (s) => (s.distance / 1000).toFixed(2);
const selectScoreText: HudTextSelector = (s) => Math.floor(s.score).toLocaleString();
const selectHighScoreText: HudTextSelector = (s) => Math.floor(s.highScore).toLocaleString();
const selectTopSpeedText: HudTextSelector = (s) => String(Math.round(s.topSpeed));

function HudText({ select }: { select: HudTextSelector }) {
  return <>{useGameStore(select)}</>;
}

interface GameHUDProps {
  isWipeout?: boolean;
  onRespawn?: () => void;
  /** Default Enter action (continue when available, else retry). */
  onRestartJourney?: () => void;
  onLoopMap?: () => void;
  onContinueJourney?: () => void;
  onReturnToMenu?: () => void;
  mapLabel?: string;
  continueLabel?: string;
  /** Final-map journey summary — show ghost best when no continuation. */
  isFinalMap?: boolean;
  ghostBestScore?: number;
}

function isDebugQuery(): boolean {
  if (typeof window === 'undefined') return false;
  const raw = new URLSearchParams(window.location.search).get('debug');
  return raw === '1' || raw === 'true';
}

export const GameHUD: React.FC<GameHUDProps> = ({
  isWipeout = false,
  onRespawn,
  onRestartJourney,
  onLoopMap,
  onContinueJourney,
  onReturnToMenu,
  mapLabel = 'Meander to Waterfall',
  continueLabel,
  isFinalMap = false,
  ghostBestScore = 0,
}) => {
  useEffect(() => whenIdle(RunResultsChunk.preload), []);
  const currentBiome = usePlayerBiome();
  const multiplier = useGameStore((s) => s.multiplier);
  const comboLabel = useGameStore((s) => s.comboLabel);
  const isNewHighScore = useGameStore((s) => s.score >= s.highScore && s.score > 0);
  const isJourneyComplete = useGameStore((s) => s.isJourneyComplete);
  const vehicleType = useGameStore((s) => s.vehicleType);

  // Stamina bar — imperative DOM mutation; no per-frame re-render
  const staminaFillRef = useRef<HTMLDivElement>(null);
  const staminaBarRef = useRef<HTMLDivElement>(null);
  const exhaustedRef = useRef(false);

  const wetnessFillRef = useRef<HTMLDivElement>(null);
  const exposureFillRef = useRef<HTMLDivElement>(null);
  const loadoutLabelRef = useRef<HTMLSpanElement>(null);

  // Shelf launch popups — imperative DOM + CSS animation; no per-frame React state.
  const launchPopupRef = useRef<HTMLDivElement>(null);
  const rewardPopupRef = useRef<HTMLDivElement>(null);
  const launchAirTimeRef = useRef<HTMLDivElement>(null);
  const launchPopupTimerRef = useRef<number | null>(null);
  const rewardPopupTimerRef = useRef<number | null>(null);

  const showTransientPopup = (
    element: HTMLDivElement | null,
    timerRef: React.MutableRefObject<number | null>,
    text: string,
    className: string,
  ) => {
    if (!element) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    element.textContent = text;
    element.classList.remove('launch-popup--visible', 'air-reward-popup--visible');
    // Force reflow so repeated launches retrigger the animation.
    void element.offsetWidth;
    element.classList.add(className, `${className}--visible`);
    timerRef.current = window.setTimeout(() => {
      element.classList.remove(`${className}--visible`);
      timerRef.current = null;
    }, 1400);
  };

  useEffect(() => {
    let prevLaunchPopup = useGameStore.getState().launchPopup;
    let prevReward = useGameStore.getState().latestReward;

    const unsub = useGameStore.subscribe((state) => {
      const popup = state.launchPopup;
      if (popup && popup !== prevLaunchPopup) {
        showTransientPopup(
          launchPopupRef.current,
          launchPopupTimerRef,
          popup.label,
          'launch-popup',
        );
      }
      prevLaunchPopup = popup;

      const reward = state.latestReward;
      if (reward && reward !== prevReward && reward.score > 0) {
        const bonus = reward.clean ? ' + CLEAN' : '';
        showTransientPopup(
          rewardPopupRef.current,
          rewardPopupTimerRef,
          `+${reward.score}${bonus}`,
          'air-reward-popup',
        );
      }
      prevReward = reward;
    });

    return () => {
      unsub();
      if (launchPopupTimerRef.current !== null) {
        window.clearTimeout(launchPopupTimerRef.current);
      }
      if (rewardPopupTimerRef.current !== null) {
        window.clearTimeout(rewardPopupTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const airSeconds = getActiveLaunchAirSeconds();
      const el = launchAirTimeRef.current;
      if (el) {
        if (airSeconds > 0.05) {
          el.textContent = `AIR! ${airSeconds.toFixed(1)}s`;
          el.classList.add('launch-airtime-hud--visible');
        } else {
          el.textContent = '';
          el.classList.remove('launch-airtime-hud--visible');
        }
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const loadoutEl = loadoutLabelRef.current;
      if (loadoutEl) {
        const loadout = getLoadoutDefinition(getActiveLoadoutId());
        loadoutEl.textContent = loadout.shortLabel;
      }

      const survival = getActiveSurvivalState();
      const mods = getActiveSurvivalModifiers();
      const wetFill = wetnessFillRef.current;
      const exposureFill = exposureFillRef.current;

      if (survival && wetFill) {
        wetFill.style.width = `${Math.round(survival.wetness * 100)}%`;
        wetFill.style.backgroundColor =
          survival.wetness > 0.65 ? '#38bdf8' : survival.wetness > 0.3 ? '#7dd3fc' : '#94a3b8';
      }

      if (mods && exposureFill) {
        const stress = mods.exposureStress;
        exposureFill.style.width = `${Math.round(stress * 100)}%`;
        exposureFill.style.backgroundColor =
          stress > 0.6 ? '#ef4444' : stress > 0.3 ? '#fbbf24' : '#86efac';
      }

      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    let prevStamina = useGameStore.getState().sprintStamina;

    const unsub = useGameStore.subscribe((state) => {
      const stamina = state.sprintStamina;
      if (stamina === prevStamina) return;
      prevStamina = stamina;

      const fill = staminaFillRef.current;
      const bar = staminaBarRef.current;
      if (!fill || !bar) return;

      fill.style.width = `${Math.round(stamina * 100)}%`;

      let color: string;
      if (stamina >= 0.5) {
        color = '#f8fafc';
      } else if (stamina >= 0.25) {
        color = '#fbbf24';
      } else {
        color = '#ef4444';
      }
      fill.style.backgroundColor = color;

      const nowExhausted = stamina === 0;
      if (nowExhausted !== exhaustedRef.current) {
        exhaustedRef.current = nowExhausted;
        bar.classList.toggle('stamina-bar--exhausted', nowExhausted);
      }
    });
    return unsub;
  }, []);

  const [comboFlash, setComboFlash] = useState('');
  const [overlayVisible, setOverlayVisible] = useState(false);
  // The session's one native module: the sim worker's READY handshake on a
  // WebGL boot, the main-thread load under ?simWorker=0, none on native WebGPU.
  // The HUD never instantiates a module just to learn that init works.
  const [native, setNative] = useState<NativeStatus & { dismissed?: boolean }>(() => ({
    status: 'loading',
  }));

  // Raw native-init errors are for `?debug=1|true`; players get a short notice.
  const debugMode = isDebugQuery();

  const biomeLabel = BIOME_HUD_LABELS[currentBiome] ?? 'CANYON SUMMER';

  useEffect(() => {
    if (!comboLabel) return;
    setComboFlash(comboLabel);
    const timeout = window.setTimeout(() => setComboFlash(''), 1200);
    return () => window.clearTimeout(timeout);
  }, [comboLabel]);

  useEffect(() => {
    if (isJourneyComplete) {
      const t = window.setTimeout(() => setOverlayVisible(true), 50);
      return () => window.clearTimeout(t);
    }
    setOverlayVisible(false);
  }, [isJourneyComplete]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isJourneyComplete && e.key === 'Enter') {
        onRestartJourney?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isJourneyComplete, onRestartJourney]);

  useEffect(() => {
    let cancelled = false;
    void probeNativeStatus().then((next) => {
      if (cancelled) return;
      if (next.status === 'failed') console.error('[Watershed WASM] native init failed', next.error);
      setNative(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isWipeout) {
    return (
      <MenuFocusScope className="hud-overlay" onStart={onRespawn}>
        <div className="hud-overlay__card">
          <div className="hud-overlay__title hud-overlay__title--wipeout">
            WIPEOUT
          </div>

          <div className="hud-overlay__score">
            Score: <span><HudText select={selectScoreText} /></span>
          </div>
          <div className="hud-overlay__line">
            High Score: <span className="hud-val--good"><HudText select={selectHighScoreText} /></span>
          </div>

          <button
            onClick={onRespawn}
            className="hud-btn hud-btn--primary"
            autoFocus
          >
            RESPAWN
          </button>

          <React.Suspense fallback={null}>
            <RunResultsPanel outcome="wipeout" />
          </React.Suspense>

          <p className="hud-overlay__hint">
            Press SPACE to respawn · Gamepad: A / Start
          </p>
        </div>
      </MenuFocusScope>
    );
  }

  if (isJourneyComplete) {
    const title = isFinalMap ? 'Campaign Complete' : 'Journey Complete';
    const journeyResults = getJourneyResultsSummary();
    return (
      <MenuFocusScope
        className={`hud-overlay journey-complete-overlay ${overlayVisible ? 'visible' : ''}`}
        onStart={onContinueJourney ?? onLoopMap}
      >
        <div className="hud-overlay__card">
          <div className="hud-overlay__title hud-overlay__title--complete">
            {title}
          </div>

          <div className="hud-overlay__map">
            {mapLabel}
          </div>

          <div className="hud-overlay__score">
            <span><HudText select={selectScoreText} /></span>
          </div>

          <div className="hud-overlay__line">
            {isNewHighScore ? (
              <span className="hud-overlay__new-best">New High Score!</span>
            ) : (
              <span>
                High Score: <span className="hud-val--good"><HudText select={selectHighScoreText} /></span>
              </span>
            )}
          </div>

          <div className="hud-overlay__line hud-overlay__line--dim">
            Top Speed: <span className="hud-val--white"><HudText select={selectTopSpeedText} /> m/s</span>
          </div>

          {journeyResults && (
            <div className="hud-overlay__stats">
              <div>
                Launch hour:{' '}
                <span className="hud-val--amber">
                  H{String(journeyResults.launchHour).padStart(2, '0')}:00
                </span>
              </div>
              <div>
                Peak wetness:{' '}
                <span className="hud-val--sky">
                  {Math.round(journeyResults.peakWetness * 100)}%
                </span>
              </div>
              <div>
                Upright distance:{' '}
                <span className="hud-val--good">
                  {Math.round(journeyResults.uprightDistanceMeters)} m
                </span>
              </div>
              <div>
                Caches:{' '}
                <span className="hud-val--white">
                  {journeyResults.cachesRetrieved} recovered
                  {journeyResults.cachesLost > 0 ? ` / ${journeyResults.cachesLost} lost` : ''}
                </span>
              </div>
            </div>
          )}

          {isFinalMap && (
            <div className="hud-overlay__line hud-overlay__line--dim">
              Ghost Best:{' '}
              <span className="hud-val--sky">
                {ghostBestScore > 0 ? Math.floor(ghostBestScore).toLocaleString() : '—'}
              </span>
            </div>
          )}

          <React.Suspense fallback={null}>
            <RunResultsPanel outcome="complete" />
          </React.Suspense>

          <div className="hud-overlay__actions">
            <button
              onClick={() => {
                onLoopMap?.();
              }}
              className="hud-btn"
            >
              RETRY MAP
            </button>

            {onContinueJourney && (
              <button
                onClick={() => {
                  onContinueJourney();
                }}
                className="hud-btn hud-btn--continue"
              >
                {continueLabel ?? 'CONTINUE'}
              </button>
            )}

            {onReturnToMenu && (
              <button
                onClick={() => {
                  onReturnToMenu();
                }}
                className="hud-btn hud-btn--ghost"
              >
                MENU
              </button>
            )}
          </div>

          <p className="hud-overlay__hint">
            Press Enter to {onContinueJourney ? 'continue' : 'retry'} · Gamepad: Start
          </p>
        </div>
      </MenuFocusScope>
    );
  }

  const multiplierColor = multiplier >= 7 ? '#ef4444' : multiplier >= 3 ? '#fbbf24' : '#f8fafc';

  return (
    <>
      {native.status === 'failed' && !native.dismissed && (
        <div className="wasm-init-banner" role="status" data-testid="wasm-init-banner">
          <div className="wasm-init-banner__body">
            {debugMode ? (
              <>
                <strong>
                  {native.mismatched
                    ? 'Native WASM provenance mismatch — stale deploy'
                    : native.timedOut
                      ? 'Native WASM init timed out'
                      : native.trapFunction
                        ? `Native WASM trapped in ${native.trapFunction}`
                        : native.exhausted
                          ? 'Native WASM heap exhausted'
                          : 'Native WASM failed to init'}
                </strong>
                <pre>{native.error}</pre>
              </>
            ) : (
              <span>Running in compatibility mode — some water effects may look simpler.</span>
            )}
          </div>
          <button
            type="button"
            className="wasm-init-banner__dismiss"
            onClick={() => setNative((prev) => ({ ...prev, dismissed: true }))}
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="hud-biome">
        <div>{biomeLabel}</div>
        <div className="survival-loadout-badge">
          LOADOUT <span ref={loadoutLabelRef}>—</span>
        </div>
      </div>

      <MovementReadout />

      <div className="hud-readout" data-testid="hud-readout">
        <div className="hud-readout__speed"><HudText select={selectSpeedText} /> <span className="hud-readout__unit">m/s</span></div>
        <div className="hud-readout__distance"><HudText select={selectDistanceKmText} /> <span className="hud-readout__unit">km</span></div>
        <div className="hud-readout__label">Score</div>
        <div className="hud-readout__score"><HudText select={selectScoreText} /></div>
      </div>

      {multiplier > 1 && (
        <div
          className="hud-multiplier"
          style={{
            color: multiplierColor,
            fontSize: multiplier >= 7 ? '3rem' : '2.25rem',
            textShadow: multiplier >= 3 ? '0 0 18px rgba(251,191,36,0.35)' : '0 0 12px rgba(255,255,255,0.2)',
          }}
        >
          ×{multiplier}
        </div>
      )}

      {comboFlash && (
        <div
          className="hud-combo"
          style={{
            color: '#fbbf24',
            fontSize: '1.1rem',
            textShadow: '0 0 12px rgba(251,191,36,0.6)',
          }}
        >
          {comboFlash}
        </div>
      )}

      <div ref={launchPopupRef} className="launch-popup" aria-live="polite" />
      <div ref={launchAirTimeRef} className="launch-airtime-hud" aria-live="polite" />
      <div ref={rewardPopupRef} className="air-reward-popup" aria-live="polite" />

      <div className="hud-best">
        Best: <strong><HudText select={selectHighScoreText} /></strong>
        <span className="hud-best__top">Top <HudText select={selectTopSpeedText} /> m/s</span>
      </div>

      <div
        className="hud-native"
        data-testid="wasm-smoke-status"
      >
        {native.status === 'none' ? 'WASM OFF' : `WASM ${native.status.toUpperCase()}`}
        {native.status === 'ready' && (
          <span className="hud-native__detail">
            {native.where === 'worker' ? 'SIM WORKER' : 'MAIN'} ABI {native.abi}
          </span>
        )}
        {native.status === 'none' && <span className="hud-native__detail">WGSL</span>}
        {native.status === 'failed' && native.trapFunction && (
          <span className="ml-2 text-red-300/70">TRAP {native.trapFunction}</span>
        )}
      </div>

      {vehicleType === 'runner' && (
        <div className="survival-hud-stack">
          <div className="stamina-bar" ref={staminaBarRef}>
            <div className="stamina-bar__label">SPRINT</div>
            <div className="stamina-bar__track">
              <div className="stamina-fill" ref={staminaFillRef} style={{ width: '100%', backgroundColor: '#f8fafc' }} />
            </div>
          </div>

          {getRunSession() && (
            <>
              <div className="survival-bar">
                <div className="survival-bar__label">WET</div>
                <div className="survival-bar__track">
                  <div className="survival-fill" ref={wetnessFillRef} style={{ width: '0%' }} />
                </div>
              </div>
              <div className="survival-bar">
                <div className="survival-bar__label">EXPOSURE</div>
                <div className="survival-bar__track">
                  <div className="survival-fill" ref={exposureFillRef} style={{ width: '0%' }} />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
};

export default GameHUD;
