/**
 * GraphicsUnsupported — the static screen for "this browser gave us no WebGL2".
 *
 * When boot negotiation cannot get a context by *any* attempt, the game must not
 * mount: R3F, Rapier's WASM world, the track treadmill, and the audio graph all
 * assume a renderer exists, and starting them anyway produced the worst possible
 * outcome — an infinite loader with no explanation.
 *
 * So this is plain DOM. No Canvas, no Three, no physics. It says what failed,
 * quotes the browser's own `statusMessage` when there was one (the only real
 * diagnostic the platform hands out), and lists the two things a player can
 * actually do about it.
 */
import React from 'react';
import { useT } from '../i18n/useT';

/** Marks a slot in a translated sentence so a `<code>` element can sit in it. */
const SLOT = '\u0000';
/** The browsers' own GPU report pages — addresses, not prose. */
const GPU_PAGES = ['chrome://gpu', 'about:support'] as const;

export interface GraphicsUnsupportedProps {
  /** `WebGLContextEvent.statusMessage` from the failed probe, if any. */
  statusMessage?: string | null;
  /**
   * True when a bare `getContext('webgl2')` succeeded but the renderer's
   * attributes (depth + stencil) were refused — a different fault from "no
   * WebGL2 here", and worth saying out loud because the browser looks fine.
   */
  attributesRejected?: boolean;
}

export default function GraphicsUnsupported({
  statusMessage,
  attributesRejected,
}: GraphicsUnsupportedProps) {
  const t = useT();
  // The sentence is translated whole; the two URLs drop into its {chrome} / {firefox} slots.
  const check = t('graphics.unsupported.check', { chrome: `${SLOT}0${SLOT}`, firefox: `${SLOT}1${SLOT}` })
    .split(SLOT)
    .map((part, i) =>
      i % 2 === 0 ? part : <code key={i}>{GPU_PAGES[part === '0' ? 0 : 1]}</code>,
    );
  return (
    <div className="graphics-unsupported" role="alert" data-testid="graphics-unsupported">
      <div className="graphics-unsupported__panel">
        <h1 className="graphics-unsupported__title">{t('graphics.unsupported.title')}</h1>
        <p className="graphics-unsupported__lead">
          {attributesRejected
            ? t('graphics.unsupported.attributes')
            : t('graphics.unsupported.noContext')}
        </p>
        <ul className="graphics-unsupported__actions">
          <li>
            <strong>{t('graphics.unsupported.accel')}</strong> {t('graphics.unsupported.accelHow')}
          </li>
          <li>
            <strong>{t('graphics.unsupported.driver')}</strong> {t('graphics.unsupported.driverWhy')}
          </li>
        </ul>
        {statusMessage ? (
          <p className="graphics-unsupported__status">
            {t('graphics.unsupported.reported')} <code>{statusMessage}</code>
          </p>
        ) : (
          <p className="graphics-unsupported__status">
            {t('graphics.unsupported.noReason')}
          </p>
        )}
        <p className="graphics-unsupported__check">
          {check}
        </p>
      </div>
    </div>
  );
}
