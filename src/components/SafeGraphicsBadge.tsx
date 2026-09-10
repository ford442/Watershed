/**
 * SafeGraphicsBadge — the session is running on a degraded graphics envelope.
 *
 * A persistent, dismissible badge rather than a toast, on purpose:
 *
 * - The machine that triggers this is the least able to afford an animated,
 *   auto-dismissing DOM overlay during boot.
 * - A 4-second toast fired during a slow boot is a notification nobody sees, and
 *   this is exactly the information a player needs when they later wonder why
 *   the game looks flat and the quality slider does not fix it.
 *
 * It reuses the `wasm-init-banner` visual language (same corner, same palette,
 * same dismiss affordance) instead of inventing a second notification system.
 * The WASM banner's own logic is untouched — this is a sibling, not a fork.
 *
 * Acknowledgement is persisted; the *tier* is not. A driver hiccup should not
 * downgrade a player permanently, so every load re-probes — but a player who has
 * dismissed the badge once should not have to dismiss it every load.
 */
import React, { useCallback, useState } from 'react';
import type { GraphicsCapabilityReason } from '../rendering/probeGraphicsCapability';
import type { BootFailureReason } from '../rendering/bootCrashGuard';

/** localStorage key for "the player has seen this". */
export const SAFE_GRAPHICS_ACK_KEY = 'watershed:safe-graphics-ack';

/** Read the acknowledgement, treating any storage failure as "not acked". */
export function readSafeGraphicsAck(): boolean {
  try {
    return window.localStorage.getItem(SAFE_GRAPHICS_ACK_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist the acknowledgement. Storage failures are silent — it is a badge. */
export function writeSafeGraphicsAck(): void {
  try {
    window.localStorage.setItem(SAFE_GRAPHICS_ACK_KEY, '1');
  } catch {
    /* private mode / quota — the badge simply reappears next load */
  }
}

const REASON_COPY: Record<GraphicsCapabilityReason, string> = {
  hardware: 'Full graphics.',
  caveat:
    'This browser refused a hardware-accelerated WebGL context, so the game is running with antialiasing off and the default GPU adapter. Enabling hardware acceleration in your browser settings, or updating your graphics driver, usually restores full quality.',
  'previous-boot-failed':
    'The previous start did not get a working WebGL context, so this one began in safe mode at Low quality. Raise it again in Options — one start that draws a frame clears the clamp on its own.',
  'capture-mode': 'Capture harness — graphics envelope pinned, not probed.',
  'no-context': 'No WebGL2 context is available.',
  'attributes-rejected':
    'This browser grants a WebGL2 context, but not with the depth and stencil buffers the renderer needs.',
};

/** What the previous boot actually did, when that is why we are in safe mode. */
const BOOT_FAILURE_COPY: Record<BootFailureReason, string> = {
  'no-frame': 'The previous start never drew a frame.',
  'context-lost': 'The previous start lost its WebGL context.',
  'renderer-throw': 'The previous start could not create a renderer.',
};

export interface SafeGraphicsBadgeProps {
  reason: GraphicsCapabilityReason;
  /** `WebGLContextEvent.statusMessage`, when the browser gave us one. */
  statusMessage?: string | null;
  /** How the previous boot failed, when that is what put us here. */
  bootFailure?: BootFailureReason | null;
  /** Injected in tests; defaults to the persisted acknowledgement. */
  initiallyDismissed?: boolean;
}

export default function SafeGraphicsBadge({
  reason,
  statusMessage,
  bootFailure,
  initiallyDismissed,
}: SafeGraphicsBadgeProps) {
  const [dismissed, setDismissed] = useState(
    () => initiallyDismissed ?? readSafeGraphicsAck()
  );
  const [showWhy, setShowWhy] = useState(false);

  const dismiss = useCallback(() => {
    setDismissed(true);
    writeSafeGraphicsAck();
  }, []);

  if (dismissed) return null;

  return (
    <div className="safe-graphics-badge" role="status" data-testid="safe-graphics-badge">
      <div className="safe-graphics-badge__body">
        <strong>Safe Graphics Mode</strong> — reduced quality.{' '}
        <button
          type="button"
          className="safe-graphics-badge__why"
          aria-expanded={showWhy}
          onClick={() => setShowWhy((open) => !open)}
        >
          {showWhy ? 'hide' : 'why?'}
        </button>
        {showWhy && (
          <p className="safe-graphics-badge__reason">
            {bootFailure ? `${BOOT_FAILURE_COPY[bootFailure]} ` : ''}
            {REASON_COPY[reason]}
            {statusMessage && (
              <>
                {' '}
                <span className="safe-graphics-badge__status">({statusMessage})</span>
              </>
            )}
          </p>
        )}
      </div>
      <button
        type="button"
        className="safe-graphics-badge__dismiss"
        aria-label="Dismiss safe graphics notice"
        onClick={dismiss}
      >
        Dismiss
      </button>
    </div>
  );
}
