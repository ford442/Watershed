import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayerBiome, useGameStore } from '../systems/GameState';
import { getActiveLaunchAirSeconds } from '../systems/score/LaunchScoringSession';
import {
  getActiveLoadoutId,
  getActiveSurvivalModifiers,
  getActiveSurvivalState,
  getJourneyResultsSummary,
  getRunSession,
} from '../systems/journey/runSession';
import { getLoadoutDefinition } from '../systems/survival';
import {
  calculateBuoyancyAndDragFallback,
  getWasm,
  type NativeWaterForceResult,
} from '../systems/water/WatershedWasm';
import RunResultsPanel from './RunResultsPanel';

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

const BIOME_LABELS: Record<string, string> = {
  canyonSummer: 'CANYON SUMMER',
  canyonAutumn: 'CANYON AUTUMN',
  alpineSpring: 'ALPINE SPRING',
  cavern: 'MYSTIC CAVERN',
  delta: 'RIVER DELTA',
  midnightMist: 'MIDNIGHT MIST',
  slotCanyon: 'SLOT CANYON',
  glacier: 'GLACIER',
  glacialMelt: 'GLACIAL MELT',
};

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
  const currentBiome = usePlayerBiome();
  const rawSpeed = useGameStore((s) => s.currentSpeed);
  const distanceMeters = useGameStore((s) => s.distance);
  const score = useGameStore((s) => s.score);
  const multiplier = useGameStore((s) => s.multiplier);
  const comboLabel = useGameStore((s) => s.comboLabel);
  const highScore = useGameStore((s) => s.highScore);
  const topSpeed = useGameStore((s) => s.topSpeed);
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
      const mods = getActiveSurvivalModifiers(useGameStore.getState().currentBiome);
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
  const [wasmSmoke, setWasmSmoke] = useState<{
    status: 'loading' | 'ready' | 'fallback';
    value: number;
    force?: NativeWaterForceResult;
  }>(() => ({
    status: 'loading',
    value: calculateBuoyancyAndDragFallback(150, 0.4, 0, -3),
  }));

  const speedMs = Math.max(0, Math.round(rawSpeed));
  const distanceKm = useMemo(() => (distanceMeters / 1000).toFixed(2), [distanceMeters]);
  const biomeLabel = BIOME_LABELS[currentBiome] ?? 'CANYON SUMMER';

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
    getWasm()
      .then((wasm) => {
        if (cancelled) return;
        const value = wasm.calculateBuoyancyAndDrag(150, 0.4, 0, -3);
        const force = wasm.calculateWaterForce(
          0, 0.45, -10,
          0, 0, 0,
          0, -1,
          4.5,
          0.5,
          150,
          1.2,
          0.47,
          1.05,
          0.7,
          performance.now() / 1000,
          0.08,
          2.4,
        );
        setWasmSmoke({ status: 'ready', value, force });
      })
      .catch(() => {
        if (cancelled) return;
        const value = calculateBuoyancyAndDragFallback(150, 0.4, 0, -3);
        setWasmSmoke({ status: 'fallback', value });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (isWipeout) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
        <div className="text-center animate-in fade-in zoom-in duration-300">
          <div className="text-7xl md:text-9xl font-black text-red-500 mb-6 tracking-tighter">
            WIPEOUT
          </div>

          <div className="text-2xl md:text-4xl text-white mb-2">
            Score: <span className="font-mono font-bold">{Math.floor(score).toLocaleString()}</span>
          </div>
          <div className="text-zinc-400 text-lg mb-8">
            High Score: <span className="font-mono text-emerald-400">{Math.floor(highScore).toLocaleString()}</span>
          </div>

          <button
            onClick={onRespawn}
            className="px-12 py-5 bg-white text-black text-2xl md:text-3xl font-black rounded-3xl hover:bg-emerald-400 hover:text-white hover:scale-105 transition-all shadow-2xl"
          >
            RESPAWN
          </button>

          <RunResultsPanel outcome="wipeout" />

          <p className="mt-8 text-zinc-600 text-sm">
            Press SPACE to respawn
          </p>
        </div>
      </div>
    );
  }

  if (isJourneyComplete) {
    const isNewHighScore = score >= highScore && score > 0;
    const title = isFinalMap ? 'Campaign Complete' : 'Journey Complete';
    const journeyResults = getJourneyResultsSummary();
    return (
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm journey-complete-overlay ${overlayVisible ? 'visible' : ''}`}
      >
        <div className="text-center max-w-3xl px-4">
          <div className="text-5xl md:text-7xl font-black text-amber-300 mb-6 tracking-tighter">
            {title}
          </div>

          <div className="text-sm md:text-base text-white/45 font-mono uppercase tracking-[0.18em] mb-6">
            {mapLabel}
          </div>

          <div className="text-3xl md:text-5xl text-white mb-4">
            <span className="font-mono font-bold">{Math.floor(score).toLocaleString()}</span>
          </div>

          <div className="text-lg md:text-xl mb-2">
            {isNewHighScore ? (
              <span className="text-emerald-400 font-bold">New High Score!</span>
            ) : (
              <span className="text-zinc-400">
                High Score: <span className="font-mono text-emerald-400">{Math.floor(highScore).toLocaleString()}</span>
              </span>
            )}
          </div>

          <div className="text-zinc-500 text-base mb-2">
            Top Speed: <span className="font-mono text-white">{Math.round(topSpeed)} m/s</span>
          </div>

          {journeyResults && (
            <div className="mt-4 mb-2 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-left max-w-lg mx-auto text-zinc-400 text-sm md:text-base">
              <div>
                Launch hour:{' '}
                <span className="font-mono text-amber-200">
                  H{String(journeyResults.launchHour).padStart(2, '0')}:00
                </span>
              </div>
              <div>
                Peak wetness:{' '}
                <span className="font-mono text-sky-300">
                  {Math.round(journeyResults.peakWetness * 100)}%
                </span>
              </div>
              <div>
                Upright distance:{' '}
                <span className="font-mono text-emerald-300">
                  {Math.round(journeyResults.uprightDistanceMeters)} m
                </span>
              </div>
              <div>
                Caches:{' '}
                <span className="font-mono text-white">
                  {journeyResults.cachesRetrieved} recovered
                  {journeyResults.cachesLost > 0 ? ` / ${journeyResults.cachesLost} lost` : ''}
                </span>
              </div>
            </div>
          )}

          {isFinalMap && (
            <div className="text-zinc-500 text-base mb-2">
              Ghost Best:{' '}
              <span className="font-mono text-sky-300">
                {ghostBestScore > 0 ? Math.floor(ghostBestScore).toLocaleString() : '—'}
              </span>
            </div>
          )}

          <RunResultsPanel outcome="complete" />

          <div className="flex flex-col md:flex-row items-center justify-center gap-4 mt-10">
            <button
              onClick={() => {
                onLoopMap?.();
              }}
              className="px-10 py-5 bg-white text-black text-xl md:text-2xl font-black rounded-3xl hover:bg-emerald-400 hover:text-white hover:scale-105 transition-all shadow-2xl"
            >
              RETRY MAP
            </button>

            {onContinueJourney && (
              <button
                onClick={() => {
                  onContinueJourney();
                }}
                className="px-10 py-5 bg-amber-300 text-black text-xl md:text-2xl font-black rounded-3xl hover:bg-sky-300 hover:scale-105 transition-all shadow-2xl"
              >
                {continueLabel ?? 'CONTINUE'}
              </button>
            )}

            {onReturnToMenu && (
              <button
                onClick={() => {
                  onReturnToMenu();
                }}
                className="px-10 py-5 bg-transparent text-white/80 text-xl md:text-2xl font-black rounded-3xl border border-white/25 hover:bg-white/10 hover:scale-105 transition-all"
              >
                MENU
              </button>
            )}
          </div>

          <p className="mt-8 text-zinc-600 text-sm">
            Press Enter to {onContinueJourney ? 'continue' : 'retry'}
          </p>
        </div>
      </div>
    );
  }

  const multiplierColor = multiplier >= 7 ? '#ef4444' : multiplier >= 3 ? '#fbbf24' : '#f8fafc';

  return (
    <>
      <div className="fixed top-4 left-4 md:top-6 md:left-6 text-xs font-mono text-white/50 tracking-[0.12em]">
        <div>{biomeLabel}</div>
        <div className="survival-loadout-badge">
          LOADOUT <span ref={loadoutLabelRef}>—</span>
        </div>
      </div>

      <div className="fixed top-4 right-4 md:top-6 md:right-6 bg-black/55 backdrop-blur-md text-right px-4 py-3 md:px-5 md:py-4 rounded-2xl border border-white/10 shadow-lg font-mono text-[#f5f1e8] min-w-[220px]">
        <div className="text-2xl md:text-3xl font-bold leading-none">{speedMs} <span className="text-sm text-white/60">m/s</span></div>
        <div className="mt-1 text-lg md:text-xl leading-none">{distanceKm} <span className="text-xs text-white/60">km</span></div>
        <div className="mt-3 text-xs uppercase tracking-wider text-white/50">Score</div>
        <div className="text-xl md:text-2xl font-bold leading-none">{Math.floor(score).toLocaleString()}</div>
      </div>

      {multiplier > 1 && (
        <div
          className="fixed top-10 left-1/2 -translate-x-1/2 font-mono font-black tracking-wider transition-opacity"
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
          className="fixed top-24 left-1/2 -translate-x-1/2 font-mono font-bold uppercase tracking-[0.16em] pointer-events-none"
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

      <div className="fixed bottom-4 right-4 md:bottom-6 md:right-6 text-white/40 text-xs md:text-sm font-mono">
        Best: <span className="text-emerald-400">{Math.floor(highScore).toLocaleString()}</span>
        <span className="ml-4 text-white/50">Top {Math.round(topSpeed)} m/s</span>
      </div>

      <div className="fixed bottom-12 right-4 md:bottom-14 md:right-6 text-white/40 text-[10px] md:text-xs font-mono text-right">
        WASM {wasmSmoke.status.toUpperCase()} {Math.round(wasmSmoke.value)}
        {wasmSmoke.force && (
          <span className="ml-2 text-sky-200/60">
            Fz {Math.round(wasmSmoke.force.forceZ)}
          </span>
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
