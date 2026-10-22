/**
 * debugHotkeysImpl.ts — F / G / P / O developer hotkeys, `?debug=1` only (#486 B).
 *
 *   F  toggle Rapier collider draw      G  toggle wireframes
 *   P  log the physics debug snapshot   O  log the physics perf snapshot
 *
 * These used to be bound for every player (gated only on clean-test), so a tap
 * on F mid-run showed collider wireframes. The hook binds nothing unless
 * `enabled` — App passes `debug.debugEnabled && !cleanTest`, and `debugEnabled`
 * is the `?debug=1` query. The DebugPanel carries the same toggles for the
 * mouse.
 */

export interface DebugHotkeyActions {
  togglePhysicsDebug: () => void;
  toggleWireframe: () => void;
}

type DebugGlobals = { __watershedPhysicsDebug?: unknown; __watershedPhysicsPerf?: unknown };

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.getAttribute !== 'function') return false;
  const tag = el.tagName;
  const role = el.getAttribute('role');
  return (
    el.isContentEditable ||
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    role === 'textbox' ||
    role === 'searchbox'
  );
}

/** Apply one key event. Exported for the unit test. */
export function applyDebugHotkey(e: Pick<KeyboardEvent, 'code' | 'repeat' | 'target'>, actions: DebugHotkeyActions): boolean {
  if (e.repeat || isTypingTarget(e.target)) return false;
  const globals = window as unknown as DebugGlobals;
  switch (e.code) {
    case 'KeyF':
      actions.togglePhysicsDebug();
      return true;
    case 'KeyG':
      actions.toggleWireframe();
      return true;
    case 'KeyP':
      if (globals.__watershedPhysicsDebug) console.info('[PhysicsDebug] Snapshot', globals.__watershedPhysicsDebug);
      return true;
    case 'KeyO':
      if (globals.__watershedPhysicsPerf) console.info('[PhysicsPerf] Snapshot', globals.__watershedPhysicsPerf);
      return true;
    default:
      return false;
  }
}

/** Bind the hotkeys on `window`; returns the disposer. */
export function attachDebugHotkeys(actions: DebugHotkeyActions): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    applyDebugHotkey(e, actions);
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
