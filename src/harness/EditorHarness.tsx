/**
 * EditorHarness.tsx — `?editor=1` in dev builds only, split out of App
 * (#521 C1): a full-page swap to the level editor, with its own Canvas and its
 * own lifecycle. A production build folds `isEditorMode` to false and drops
 * the lot.
 */
import React, { useEffect, useState } from 'react';
import meadowToWaterfall from '../maps/meander_to_waterfall.json';
import { queryFlags } from '../config/queryFlags';

// Evaluated at module load, so isEditorMode is a constant for the page's life.
export const isEditorMode =
  typeof import.meta !== 'undefined' &&
  (import.meta as any).env?.DEV === true &&
  queryFlags().editor;

export function EditorHarness() {
  // Dynamic import for editor — keeps LevelEditor out of the production bundle.
  const [EditorComponent, setEditorComponent] =
    useState<React.ComponentType<{ initialLevelData?: any }> | null>(null);

  useEffect(() => {
    import('../components/LevelEditor')      // resolves via index.ts barrel
      .then((m) => setEditorComponent(() => m.LevelEditor))
      .catch((err) => console.error('[App] Failed to load LevelEditor:', err));
  }, []);

  if (EditorComponent) return <EditorComponent initialLevelData={meadowToWaterfall} />;
  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0a0a0a', color: '#fff', fontFamily: 'system-ui',
    }}>
      Loading editor…
    </div>
  );
}
