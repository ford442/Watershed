/**
 * useDebugHotkeys.ts — F / G / P / O developer hotkeys, `?debug=1` only (#486 B).
 *
 *   F  toggle Rapier collider draw      G  toggle wireframes
 *   P  log the physics debug snapshot   O  log the physics perf snapshot
 *
 * These used to be bound for every player (gated only on clean-test), so a tap
 * on F mid-run showed collider wireframes. The hook binds nothing unless
 * `enabled` — App passes `debug.debugEnabled && !cleanTest`, and `debugEnabled`
 * is the `?debug=1` query. The DebugPanel carries the same toggles for the
 * mouse. The key handling is `debugHotkeysImpl.ts`, fetched only when enabled,
 * so a player's build carries none of it.
 */

import { useEffect } from 'react';
import type { DebugHotkeyActions } from './debugHotkeysImpl';

export type { DebugHotkeyActions } from './debugHotkeysImpl';

export function useDebugHotkeys(enabled: boolean, actions: DebugHotkeyActions): void {
  const { togglePhysicsDebug, toggleWireframe } = actions;
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let dispose: (() => void) | null = null;
    import('./debugHotkeysImpl').then(
      (m) => {
        if (!cancelled) dispose = m.attachDebugHotkeys({ togglePhysicsDebug, toggleWireframe });
      },
      (err: unknown) => console.warn('[useDebugHotkeys] failed to load:', err),
    );
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [enabled, togglePhysicsDebug, toggleWireframe]);
}
