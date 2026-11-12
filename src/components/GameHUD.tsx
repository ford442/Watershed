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
import type { BiomeId } from '../configs/biomes';
import { queryFlags } from '../config/queryFlags';
import { useT } from '../i18n/useT';
import { getLocale, type PlainKey } from '../i18n/i18n';
import { formatLaunchHour, formatNumber, formatPercent } from '../i18n/format';
import type { LoadoutId } from '../systems/survival';
import { airTimeParts, writeAirTime, type AirTimeWriter } from './hudAirTime';

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

/**
 * The readouts' number formats, rebuilt only when the locale changes: the
 * selectors run on every store write, so they reuse two formatters instead of
 * `toLocaleString()` (which builds one per call) or the keyed format.ts cache.
 */
let readoutLocale = '';
let intFormat: Intl.NumberFormat | null = null;
let km2Format: Intl.NumberFormat | null = null;
function readoutFormats(): { int: Intl.NumberFormat; km2: Intl.NumberFormat } {
  const locale = getLocale();
  if (locale !== readoutLocale || !intFormat || !km2Format) {
    readoutLocale = locale;
    intFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    km2Format = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return { int: intFormat, km2: km2Format };
}

const selectSpeedText: HudTextSelector = (s) => readoutFormats().int.format(Math.max(0, Math.round(s.currentSpeed)));
const selectDistanceKmText: HudTextSelector = (s) => readoutFormats().km2.format(s.distance / 1000);
const selectScoreText: HudTextSelector = (s) => readoutFormats().int.format(Math.floor(s.score));
const selectHighScoreText: HudTextSelector = (s) => readoutFormats().int.format(Math.floor(s.highScore));
const selectTopSpeedText: HudTextSelector = (s) => readoutFormats().int.format(Math.round(s.topSpeed));

function HudText({ select }: { select: HudTextSelector }) {
  // Subscribed to the locale so a language change re-runs the selector's format.
  useT();
  return <>{useGameStore(select)}</>;
}

/** HUD badge names for the biomes that have one (BIOME_HUD_LABELS' ids). */
const HUD_BIOME_KEYS: Partial<Record<BiomeId, PlainKey>> = {
  canyonSummer: 'biome.canyonSummer',
  canyonAutumn: 'biome.canyonAutumn',
  delta: 'biome.delta',
  slotCanyon: 'biome.slotCanyon',
  glacier: 'biome.glacier',
  glacialMelt: 'biome.glacialMelt',
  cavern: 'biome.cavern',
  lumberFlume: 'biome.lumberFlume',
  hydroDam: 'biome.hydroDam',
};

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
  return queryFlags().debug;
}

export const GameHUD: React.FC<GameHUDProps> = ({
  isWipeout = false,
  onRespawn,
  onRestartJourney,
  onLoopMap,
  onContinueJourney,
  onReturnToMenu,
  mapLabel,
  continueLabel,
  isFinalMap = false,
  ghostBestScore = 0,
}) => {
  const t = useT();
  // The latest `t` for the store subscription and the rAF ticks, which outlive renders.
  const tRef = useRef(t);
  useEffect(() => whenIdle(RunResultsChunk.preload), []);
  const currentBiome = usePlayerBiome();
  const multiplier = useGameStore((s) => s.multiplier);
  const comboLabelKey = useGameStore((s) => s.comboLabelKey);
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
  // Air-time text split once per locale; the tick only concatenates (hudAirTime.ts).
  const airWriterRef = useRef<AirTimeWriter | null>(null);
  // The loadout badge's text per locale, resolved outside the tick.
  const loadoutTextRef = useRef<{ id: LoadoutId | null; text: string }>({ id: null, text: '' });

  useEffect(() => {
    tRef.current = t;
    airWriterRef.current = { parts: airTimeParts(t), bucket: -1 };
    loadoutTextRef.current = { id: null, text: '' };
  }, [t]);
  const showTransientPopup = (
    element: HTMLDivElement | null,
    timerRef: { current: number | null },
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
    // The popups' pending hide timers. Owned by this effect (not component refs), so
    // the cleanup clears exactly the timers this subscription started.
    const launchPopupTimerRef: { current: number | null } = { current: null };
    const rewardPopupTimerRef: { current: number | null } = { current: null };
    let prevLaunchPopup = useGameStore.getState().launchPopup;
    let prevReward = useGameStore.getState().latestReward;

    const unsub = useGameStore.subscribe((state) => {
      const popup = state.launchPopup;
      if (popup && popup !== prevLaunchPopup) {
        showTransientPopup(
          launchPopupRef.current,
          launchPopupTimerRef,
          tRef.current(popup.labelKey),
          'launch-popup',
        );
      }
      prevLaunchPopup = popup;

      const reward = state.latestReward;
      if (reward && reward !== prevReward && reward.score > 0) {
        const tr = tRef.current;
        const score = String(reward.score);
        showTransientPopup(
          rewardPopupRef.current,
          rewardPopupTimerRef,
          reward.clean ? tr('hud.rewardClean', { score }) : tr('hud.reward', { score }),
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
      const el = launchAirTimeRef.current;
      const writer = airWriterRef.current;
      if (el && writer) writeAirTime(el, getActiveLaunchAirSeconds(), writer);
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
        const id = getActiveLoadoutId();
        const cached = loadoutTextRef.current;
        if (cached.id !== id) {
          // A loadout or locale change: resolve once, write once.
          cached.id = id;
          cached.text = tRef.current(getLoadoutDefinition(id).shortLabelKey);
          loadoutEl.textContent = cached.text;
        }
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

  const biomeLabel = t(HUD_BIOME_KEYS[currentBiome] ?? 'biome.canyonSummer');

  useEffect(() => {
    if (!comboLabelKey) return;
    setComboFlash(tRef.current(comboLabelKey));
    const timeout = window.setTimeout(() => setComboFlash(''), 1200);
    return () => window.clearTimeout(timeout);
  }, [comboLabelKey]);

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
            {t('hud.wipeout')}
          </div>

          <div className="hud-overlay__score">
            {t('hud.scoreLabel')} <span><HudText select={selectScoreText} /></span>
          </div>
          <div className="hud-overlay__line">
            {t('hud.highScoreLabel')} <span className="hud-val--good"><HudText select={selectHighScoreText} /></span>
          </div>

          <button
            onClick={onRespawn}
            className="hud-btn hud-btn--primary"
            autoFocus
          >
            {t('hud.respawn')}
          </button>

          <React.Suspense fallback={null}>
            <RunResultsPanel outcome="wipeout" />
          </React.Suspense>

          <p className="hud-overlay__hint">
            {t('hud.wipeoutHint')}
          </p>
        </div>
      </MenuFocusScope>
    );
  }

  if (isJourneyComplete) {
    const title = isFinalMap ? t('hud.campaignComplete') : t('hud.journeyComplete');
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
            {mapLabel ?? t('map.meander')}
          </div>

          <div className="hud-overlay__score">
            <span><HudText select={selectScoreText} /></span>
          </div>

          <div className="hud-overlay__line">
            {isNewHighScore ? (
              <span className="hud-overlay__new-best">{t('hud.newHighScore')}</span>
            ) : (
              <span>
                {t('hud.highScoreLabel')} <span className="hud-val--good"><HudText select={selectHighScoreText} /></span>
              </span>
            )}
          </div>

          <div className="hud-overlay__line hud-overlay__line--dim">
            {t('hud.topSpeedLabel')}{' '}
            <span className="hud-val--white">
              <HudText select={selectTopSpeedText} /> {t('unit.mps')}
            </span>
          </div>

          {journeyResults && (
            <div className="hud-overlay__stats">
              <div>
                {t('hud.statLaunchHour')}{' '}
                <span className="hud-val--amber">
                  {formatLaunchHour(journeyResults.launchHour)}
                </span>
              </div>
              <div>
                {t('hud.statPeakWetness')}{' '}
                <span className="hud-val--sky">
                  {formatPercent(journeyResults.peakWetness)}
                </span>
              </div>
              <div>
                {t('hud.statUprightDistance')}{' '}
                <span className="hud-val--good">
                  {formatNumber(Math.round(journeyResults.uprightDistanceMeters))} {t('unit.m')}
                </span>
              </div>
              <div>
                {t('hud.statCaches')}{' '}
                <span className="hud-val--white">
                  {journeyResults.cachesLost > 0
                    ? t('hud.cachesRecoveredLost', {
                        recovered: journeyResults.cachesRetrieved,
                        lost: journeyResults.cachesLost,
                      })
                    : t('hud.cachesRecovered', { recovered: journeyResults.cachesRetrieved })}
                </span>
              </div>
            </div>
          )}

          {isFinalMap && (
            <div className="hud-overlay__line hud-overlay__line--dim">
              {t('hud.ghostBestLabel')}{' '}
              <span className="hud-val--sky">
                {ghostBestScore > 0 ? formatNumber(Math.floor(ghostBestScore)) : '—'}
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
              {t('hud.retryMap')}
            </button>

            {onContinueJourney && (
              <button
                onClick={() => {
                  onContinueJourney();
                }}
                className="hud-btn hud-btn--continue"
              >
                {continueLabel ?? t('hud.continue')}
              </button>
            )}

            {onReturnToMenu && (
              <button
                onClick={() => {
                  onReturnToMenu();
                }}
                className="hud-btn hud-btn--ghost"
              >
                {t('hud.menu')}
              </button>
            )}
          </div>

          <p className="hud-overlay__hint">
            {onContinueJourney ? t('hud.completeHintContinue') : t('hud.completeHintRetry')}
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
                {/* Developer readout under ?debug=1: not translated (#566 out of scope). */}
                {/* eslint-disable no-restricted-syntax */}
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
                {/* eslint-enable no-restricted-syntax */}
                <pre>{native.error}</pre>
              </>
            ) : (
              <span>{t('hud.compatMode')}</span>
            )}
          </div>
          <button
            type="button"
            className="wasm-init-banner__dismiss"
            onClick={() => setNative((prev) => ({ ...prev, dismissed: true }))}
          >
            {t('hud.dismiss')}
          </button>
        </div>
      )}
      <div className="hud-biome">
        <div>{biomeLabel}</div>
        <div className="survival-loadout-badge">
          {t('hud.loadoutBadge')} <span ref={loadoutLabelRef}>—</span>
        </div>
      </div>

      <MovementReadout />

      <div className="hud-readout" data-testid="hud-readout">
        <div className="hud-readout__speed"><HudText select={selectSpeedText} /> <span className="hud-readout__unit">{t('unit.mps')}</span></div>
        <div className="hud-readout__distance"><HudText select={selectDistanceKmText} /> <span className="hud-readout__unit">{t('unit.km')}</span></div>
        <div className="hud-readout__label">{t('hud.scoreReadout')}</div>
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
        {t('hud.bestLabel')} <strong><HudText select={selectHighScoreText} /></strong>
        <span className="hud-best__top">
          {t('hud.topLabel')} <HudText select={selectTopSpeedText} /> {t('unit.mps')}
        </span>
      </div>

      <div
        className="hud-native"
        data-testid="wasm-smoke-status"
      >
        {/* The native-module status row is a developer readout: not translated (#566 out of scope). */}
        {/* eslint-disable no-restricted-syntax */}
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
        {/* eslint-enable no-restricted-syntax */}
      </div>

      {vehicleType === 'runner' && (
        <div className="survival-hud-stack">
          <div className="stamina-bar" ref={staminaBarRef}>
            <div className="stamina-bar__label">{t('hud.sprint')}</div>
            <div className="stamina-bar__track">
              <div className="stamina-fill" ref={staminaFillRef} style={{ width: '100%', backgroundColor: '#f8fafc' }} />
            </div>
          </div>

          {getRunSession() && (
            <>
              <div className="survival-bar">
                <div className="survival-bar__label">{t('hud.wet')}</div>
                <div className="survival-bar__track">
                  <div className="survival-fill" ref={wetnessFillRef} style={{ width: '0%' }} />
                </div>
              </div>
              <div className="survival-bar">
                <div className="survival-bar__label">{t('hud.exposure')}</div>
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
