/**
 * Workshop.tsx — the River Workshop: the player-facing river editor, opened
 * from the start menu (River Workshop A). One lazy chunk (`build-budget.json`
 * `workshopMaxBytes`); nothing here rides the entry.
 *
 *   - Segment Inspector (left), 3D viewport (centre), Biome Selector (right),
 *     validation (bottom), as the 2025 dev editor had them;
 *   - state in `workshopStore` — `LevelData` as the source of truth, zundo
 *     undo / redo (toolbar, Ctrl/Cmd+Z, Shift+Z / Ctrl+Y, gamepad LB / RB);
 *   - Test run plays the draft as a player river and comes back here, to the
 *     same level, history and camera;
 *   - Share makes a `#river=` link, or a compressed `.wsriver` when the river
 *     is too big for one.
 *
 * The Workshop is drawn over the game (which idles in its menu state under
 * it), on its own Canvas with the game's renderer contract.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid } from '@react-three/drei';
import { WorkshopOrbitControls } from './viewportPrimitives';
import { SegmentInspector } from './SegmentInspector';
import { BiomeSelector } from './BiomeSelector';
import { ErrorPanel } from './ErrorPanel';
import { PathVisualizer } from './PathVisualizer';
import type { EditorSegmentConfig } from './editorSegments';
import { levelWaypoints } from './editorSegments';
import { createGameRenderer } from '../rendering/createRenderer';
import {
  deriveEditorContextOptions,
  shadowModeToCanvasProp,
} from '../rendering/deriveRendererContextOptions';
import { validateEditorLevel } from './levelEditorValidator';
import type { LevelData } from '../systems/map/MapSystem.types';
import type { UserRiver } from '../systems/map/userRiverSession';
import { parseRiverText, rememberRiver, riverIdFromName } from '../systems/map/userRiverImport';
import { createUserRiver } from '../systems/map/userRiverSession';
import { parseAndValidateUserLevel } from '../systems/map/userLevelStore';
import { shareRiver } from '../systems/map/riverShare';
import { saveRiverFile } from './saveRiverFile';
import { selectSegments, useWorkshop, useWorkshopHistory, workshopStore } from './workshopStore';
import { useHistoryInput } from './useHistoryInput';
import { createBlankRiver, levelFromCampaignMap, listStartFromMaps } from './workshopTemplates';

/**
 * The editor Canvas honours the same renderer contract as the game Canvas
 * (#337): one derive function, one apply function, so a change to the contract
 * cannot silently skip the editor. It pins the `high` preset — an authoring
 * tool wants the default look, not whatever the player last chose for
 * performance — and allows software GL, because a slow editor beats an editor
 * that will not boot.
 */
const EDITOR_CONTEXT_OPTIONS = deriveEditorContextOptions();

export interface WorkshopProps {
  /** A river to open (a shared link's "Open in Workshop"); replaces the draft, undoably. */
  seed?: LevelData | null;
  onClose: () => void;
  /** Play the draft; the host brings the Workshop back when the run ends. */
  onTestRun: (river: UserRiver) => void;
}

const toolbarButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: '4px',
  color: '#ccc',
  fontSize: '12px',
  cursor: 'pointer',
};

const disabledStyle: React.CSSProperties = { opacity: 0.4, cursor: 'not-allowed' };

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/^\[MAP_REGISTRY\]\s*/, '');
}

/** Field-level diff of an inspector edit: only what changed is written back. */
function changedFields(before: EditorSegmentConfig, after: EditorSegmentConfig): Partial<EditorSegmentConfig> {
  const out: Partial<EditorSegmentConfig> = {};
  for (const key of Object.keys(after) as Array<keyof EditorSegmentConfig>) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      (out as Record<string, unknown>)[key] = after[key];
    }
  }
  return out;
}

/** Restores the camera the Workshop last closed with, and remembers it on unmount. */
function CameraMemory() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as {
    target: { set(x: number, y: number, z: number): void; x: number; y: number; z: number };
    update(): void;
  } | null;
  useEffect(() => {
    if (!controls) return undefined;
    const saved = workshopStore.getState().camera;
    if (saved) {
      camera.position.set(...saved.position);
      controls.target.set(...saved.target);
      controls.update();
    }
    return () => {
      workshopStore.getState().setCamera({
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      });
    };
  }, [camera, controls]);
  return null;
}

function openFilePicker(onText: (text: string, name: string) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.wsriver,.json,application/json';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    file.text().then(
      (text) => onText(text, file.name),
      (err: unknown) => console.error('[Workshop] could not read file', err),
    );
  };
  input.click();
}

type Modal = { kind: 'export'; json: string } | { kind: 'share'; url: string } | null;

function StartFrom({ onPick, onOpen, onClose, notice }: {
  onPick: (level: LevelData) => void;
  onOpen: () => void;
  onClose: () => void;
  notice: string | null;
}) {
  const maps = listStartFromMaps();
  return (
    <div className="workshop-start" role="dialog" aria-label="River Workshop — start from">
      <h2>River Workshop</h2>
      <p>Start a new river from a blank template or any campaign map, or open a .wsriver file.</p>
      <div className="workshop-start-grid">
        <button type="button" style={toolbarButtonStyle} onClick={() => onPick(createBlankRiver())}>
          Blank river
        </button>
        {maps.map((m) => (
          <button key={m.id} type="button" style={toolbarButtonStyle} onClick={() => onPick(levelFromCampaignMap(m.id))}>
            {m.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <button type="button" style={toolbarButtonStyle} onClick={onOpen}>Open file…</button>
        <button type="button" style={toolbarButtonStyle} onClick={onClose}>Back to menu</button>
      </div>
      {notice && <p className="workshop-notice" role="status">{notice}</p>}
    </div>
  );
}

export default function Workshop({ seed, onClose, onTestRun }: WorkshopProps) {
  const level = useWorkshop((s) => s.level);
  const segments = useWorkshop(selectSegments);
  const selectedSegmentIndex = useWorkshop((s) => s.selectedSegmentIndex);
  const viewportMode = useWorkshop((s) => s.viewportMode);
  const canUndo = useWorkshopHistory((h) => h.pastStates.length > 0);
  const canRedo = useWorkshopHistory((h) => h.futureStates.length > 0);
  const [showErrors, setShowErrors] = useState(true);
  const [modal, setModal] = useState<Modal>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useHistoryInput(true);

  // A seed (shared link) opens once per seed object.
  const seeded = useRef<LevelData | null>(null);
  useEffect(() => {
    if (seed && seeded.current !== seed) {
      seeded.current = seed;
      workshopStore.getState().loadLevel(structuredClone(seed));
    }
  }, [seed]);

  const store = workshopStore.getState();
  const validationResult = validateEditorLevel(segments);
  const hasErrors = validationResult.errors.length > 0;
  const currentSegment = segments.find((s) => s.index === selectedSegmentIndex) ?? null;

  const handleSegmentChange = useCallback((updated: EditorSegmentConfig) => {
    const before = selectSegments(workshopStore.getState()).find((s) => s.index === updated.index);
    if (!before) return;
    const updates = changedFields(before, updated);
    const keys = Object.keys(updates).sort();
    if (keys.length === 0) return;
    workshopStore.getState().updateSegment(updated.index, updates, { coalesce: `seg:${updated.index}:${keys.join(',')}` });
  }, []);

  const handleNavigateToField = useCallback((field: string) => {
    const match = field.match(/segments\[(\d+)\]/);
    if (match) workshopStore.getState().selectSegment(parseInt(match[1], 10));
  }, []);

  const handleOpenFile = useCallback(() => {
    openFilePicker((text, name) => {
      try {
        workshopStore.getState().loadLevel(parseRiverText(text, name).level);
        setNotice(null);
      } catch (err) {
        setNotice(errorText(err));
      }
    });
  }, []);

  const validDraft = useCallback((): UserRiver | null => {
    const draft = workshopStore.getState().level;
    if (!draft) return null;
    const id = riverIdFromName(draft.metadata?.name || 'river');
    try {
      return createUserRiver(id, parseAndValidateUserLevel(draft, id));
    } catch (err) {
      setNotice(errorText(err));
      return null;
    }
  }, []);

  const handleTestRun = useCallback(() => {
    const river = validDraft();
    if (!river) return;
    rememberRiver(river);
    setNotice(null);
    onTestRun(river);
  }, [onTestRun, validDraft]);

  const handleSave = useCallback(() => {
    const river = validDraft();
    if (!river) return;
    rememberRiver(river);
    setNotice(`Saved “${river.label}” to Your Rivers.`);
  }, [validDraft]);

  const handleShare = useCallback(() => {
    const river = validDraft();
    if (!river) return;
    const result = shareRiver(river.level);
    if (result.kind === 'link') {
      setModal({ kind: 'share', url: result.url });
      return;
    }
    setNotice(`This river is too big for a link (${result.payloadChars} characters). Saving it as a .wsriver file instead.`);
    saveRiverFile(river.level).then(
      (outcome) => {
        if (outcome !== 'cancelled') setNotice('Saved as a .wsriver file — send it to a friend, who loads it under Your Rivers.');
      },
      (err: unknown) => setNotice(errorText(err)),
    );
  }, [validDraft]);

  const handleSaveFile = useCallback(() => {
    const draft = workshopStore.getState().level;
    if (!draft) return;
    saveRiverFile(draft).then(
      () => undefined,
      (err: unknown) => setNotice(errorText(err)),
    );
  }, []);

  if (!level) {
    return (
      <div className="workshop-root">
        <StartFrom
          onPick={(l) => store.loadLevel(l)}
          onOpen={handleOpenFile}
          onClose={onClose}
          notice={notice}
        />
      </div>
    );
  }

  const waypoints = levelWaypoints(level);

  return (
    <div className="workshop-root" aria-label="River Workshop">
      {/* Toolbar */}
      <div className="workshop-toolbar" role="toolbar" aria-label="Workshop">
        <span className="workshop-title">RIVER WORKSHOP</span>
        <button type="button" style={toolbarButtonStyle} onClick={() => workshopStore.setState({ level: null })}>
          New
        </button>
        <button type="button" style={toolbarButtonStyle} onClick={handleOpenFile}>Open</button>
        <button type="button" style={toolbarButtonStyle} onClick={handleSave}>Save</button>
        <button type="button" style={toolbarButtonStyle} onClick={handleSaveFile}>Save file</button>
        <div className="workshop-toolbar-sep" />
        <button
          type="button"
          style={{ ...toolbarButtonStyle, ...(canUndo ? {} : disabledStyle) }}
          disabled={!canUndo}
          onClick={() => store.undo()}
          aria-label="Undo"
          title="Undo (Ctrl/Cmd+Z, gamepad LB)"
        >
          ↶ Undo
        </button>
        <button
          type="button"
          style={{ ...toolbarButtonStyle, ...(canRedo ? {} : disabledStyle) }}
          disabled={!canRedo}
          onClick={() => store.redo()}
          aria-label="Redo"
          title="Redo (Ctrl/Cmd+Shift+Z, gamepad RB)"
        >
          ↷ Redo
        </button>
        <div className="workshop-toolbar-sep" />
        <button
          type="button"
          onClick={handleTestRun}
          style={{
            ...toolbarButtonStyle,
            background: hasErrors ? '#333' : '#1a5a1a',
            borderColor: hasErrors ? '#444' : '#3a9a3a',
            ...(hasErrors ? disabledStyle : {}),
          }}
          disabled={hasErrors}
        >
          ▶ Test run
        </button>
        <button type="button" style={{ ...toolbarButtonStyle, ...(hasErrors ? disabledStyle : {}) }} disabled={hasErrors} onClick={handleShare}>
          Share
        </button>
        <button
          type="button"
          style={toolbarButtonStyle}
          onClick={() => setModal({ kind: 'export', json: JSON.stringify(level, null, 2) })}
        >
          Export JSON
        </button>
        <span className="workshop-toolbar-status" role="status">
          {notice ?? (hasErrors ? 'Fix errors before playing' : '')}
        </span>
        <button type="button" style={toolbarButtonStyle} onClick={onClose} aria-label="Close the Workshop">
          ✕ Close
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: Segment Inspector. Pointer-up / blur ends the edit gesture (one undo step). */}
        <div
          style={{ display: 'flex' }}
          onPointerUp={() => store.endGesture()}
          onBlur={() => store.endGesture()}
        >
          <SegmentInspector
            segment={currentSegment}
            totalSegments={segments.length}
            onChange={handleSegmentChange}
            onSelectSegment={(i) => store.selectSegment(i)}
            errors={validationResult.errors}
          />
        </div>

        {/* Centre: 3D viewport */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div className="workshop-viewbar">
            {(['3d', 'top', 'side'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => store.setViewportMode(mode)}
                className={viewportMode === mode ? 'workshop-viewbar-btn is-active' : 'workshop-viewbar-btn'}
              >
                {mode}
              </button>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#888' }}>
              {level.metadata?.name} • {segments.length} segments
            </span>
          </div>

          <div style={{ flex: 1, minHeight: 0 }}>
            <Canvas
              camera={{ position: [50, 50, 50], fov: 50, up: [0, 1, 0] }}
              dpr={[1, EDITOR_CONTEXT_OPTIONS.dprMax]}
              shadows={shadowModeToCanvasProp(EDITOR_CONTEXT_OPTIONS.shadowMode)}
              gl={async (props) =>
                createGameRenderer(props, {
                  preference: 'webgl',
                  contextOptions: EDITOR_CONTEXT_OPTIONS,
                  materialBackend: 'glsl',
                })
              }
            >
              <ambientLight intensity={0.5} />
              <directionalLight position={[10, 20, 10]} intensity={1} />
              <Grid
                position={[0, -5, 0]}
                args={[200, 200]}
                cellSize={10}
                cellThickness={0.5}
                cellColor="#333"
                sectionSize={50}
                sectionThickness={1}
                sectionColor="#444"
                fadeDistance={400}
                fadeStrength={1}
                infiniteGrid
              />
              <PathVisualizer
                waypoints={waypoints}
                segments={segments}
                selectedSegment={selectedSegmentIndex}
                onSelectSegment={(i) => store.selectSegment(i)}
              />
              <WorkshopOrbitControls
                enableRotate={viewportMode === '3d'}
                minDistance={10}
                maxDistance={300}
              />
              <CameraMemory />
            </Canvas>
          </div>

          {showErrors && (
            <div className="workshop-errors">
              <div className="workshop-errors-head">
                <span style={{ fontSize: '12px', fontWeight: 600 }}>Validation</span>
                <button type="button" className="workshop-icon-btn" onClick={() => setShowErrors(false)} aria-label="Hide validation">
                  ×
                </button>
              </div>
              <ErrorPanel
                errors={validationResult.errors}
                warnings={validationResult.warnings}
                onNavigateToField={handleNavigateToField}
              />
            </div>
          )}
        </div>

        {/* Right: Biome Selector */}
        <BiomeSelector
          selectedBiome={level.world.biome.baseType}
          onSelect={(biome) => store.setWorldBiome(biome)}
          onApplyToAll={() => store.setWorldBiome(level.world.biome.baseType, { clearOverrides: true })}
          onApplyToSegment={() =>
            store.updateSegment(selectedSegmentIndex, { biomeOverride: level.world.biome.baseType })
          }
        />
      </div>

      {modal && (
        <div className="workshop-modal" role="dialog" aria-label={modal.kind === 'share' ? 'Share river' : 'Export JSON'}>
          <div className="workshop-modal-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#fff', fontSize: '16px' }}>
                {modal.kind === 'share' ? 'Share this river' : 'Export JSON'}
              </h3>
              <button type="button" className="workshop-icon-btn" onClick={() => setModal(null)} aria-label="Close">×</button>
            </div>
            {modal.kind === 'share' && (
              <p style={{ margin: 0, color: '#aaa', fontSize: '12px' }}>
                Anyone who opens this link gets the river in their own copy of the game — no server, works offline.
                The river travels in the link’s #fragment, which browsers never send to a host.
              </p>
            )}
            <textarea
              value={modal.kind === 'share' ? modal.url : modal.json}
              readOnly
              className="workshop-modal-text"
              style={{ minHeight: modal.kind === 'share' ? '96px' : '320px' }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  const text = modal.kind === 'share' ? modal.url : modal.json;
                  navigator.clipboard?.writeText(text).then(
                    () => setNotice(modal.kind === 'share' ? 'Link copied.' : 'JSON copied.'),
                    (err: unknown) => console.warn('[Workshop] copy to clipboard failed', err),
                  );
                }}
                style={toolbarButtonStyle}
              >
                Copy
              </button>
              <button type="button" onClick={() => setModal(null)} style={toolbarButtonStyle}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
