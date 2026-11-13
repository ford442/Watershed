/**
 * CP2 · CPU — physics colliders: the physics HUD / collider wireframe and
 * geometry wireframe toggles (#559 C, from `DebugPanel.tsx`).
 */
import React from 'react';
import { SectionTitle } from './primitives';

export function PhysicsDebugSection({
  physicsDebug,
  onTogglePhysicsDebug,
  wireframeDebug,
  onToggleWireframeDebug,
}: {
  physicsDebug: boolean;
  onTogglePhysicsDebug?: (val: boolean) => void;
  wireframeDebug: boolean;
  onToggleWireframeDebug?: (val: boolean) => void;
}) {
  return (
    <>
      <SectionTitle>CP2 · CPU — Physics Colliders</SectionTitle>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={physicsDebug}
          onChange={(e) => onTogglePhysicsDebug?.(e.target.checked)}
        />
        <span style={{ color: physicsDebug ? '#6dde7a' : '#d0d0d0' }}>
          Show physics HUD + collider wireframes (F)
        </span>
      </label>
      {physicsDebug && (
        <div style={{ color: '#f5c542', fontSize: 10, marginBottom: 4 }}>
          ↳ Press P to log current physics snapshot in the console
        </div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 4, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={wireframeDebug}
          onChange={(e) => onToggleWireframeDebug?.(e.target.checked)}
        />
        <span style={{ color: wireframeDebug ? '#6dde7a' : '#d0d0d0' }}>
          Wireframe geometry overlay (G)
        </span>
      </label>
    </>
  );
}
