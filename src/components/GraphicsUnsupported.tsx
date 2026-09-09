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

export interface GraphicsUnsupportedProps {
  /** `WebGLContextEvent.statusMessage` from the failed probe, if any. */
  statusMessage?: string | null;
}

export default function GraphicsUnsupported({ statusMessage }: GraphicsUnsupportedProps) {
  return (
    <div className="graphics-unsupported" role="alert" data-testid="graphics-unsupported">
      <div className="graphics-unsupported__panel">
        <h1 className="graphics-unsupported__title">Watershed needs WebGL 2</h1>
        <p className="graphics-unsupported__lead">
          This browser could not create a WebGL 2 context, so the game cannot start.
        </p>
        <ul className="graphics-unsupported__actions">
          <li>
            <strong>Turn on hardware acceleration.</strong> In Chrome: Settings → System →
            “Use graphics acceleration when available”, then restart the browser.
          </li>
          <li>
            <strong>Update your graphics driver.</strong> A blocklisted or crashed driver
            is refused even when the GPU itself is capable.
          </li>
        </ul>
        {statusMessage ? (
          <p className="graphics-unsupported__status">
            Browser reported: <code>{statusMessage}</code>
          </p>
        ) : (
          <p className="graphics-unsupported__status">
            The browser gave no reason for the refusal.
          </p>
        )}
        <p className="graphics-unsupported__check">
          You can confirm the browser’s own view at{' '}
          <code>chrome://gpu</code> (Chromium) or <code>about:support</code> (Firefox).
        </p>
      </div>
    </div>
  );
}
