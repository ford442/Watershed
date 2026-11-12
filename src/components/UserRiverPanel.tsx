/**
 * UserRiverPanel — the StartMenu's "Your rivers": load a `.wsriver` (file,
 * drop or paste — a pasted `#river=` link works too), play or edit one the
 * River Workshop saved, and offer a river shared as a link (`#river=` in the
 * page's fragment, River Workshop D) as "Play / Open in Workshop".
 *
 * Loaded lazily by the StartMenu: it carries the level validator
 * (userRiverImport.ts), which must stay out of the entry chunk.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  RIVER_FILE_ACCEPT,
  importRiverFile,
  listSavedRivers,
  parseRiverText,
  parseSharedRiver,
  rememberRiver,
} from '../systems/map/userRiverImport';
import type { UserRiver } from '../systems/map/userRiverSession';
import type { LevelData } from '../systems/map/MapSystem.types';
import { riverShareFragment } from '../systems/map/riverShare';

interface UserRiverPanelProps {
  bootReady: boolean;
  onPlay: (river: UserRiver) => void;
  /** Open a river in the River Workshop (absent: no Edit buttons). */
  onOpenInWorkshop?: (level: LevelData) => void;
}

type SharedState = { river: UserRiver; error?: undefined } | { river?: undefined; error: string } | null;

/** The page's `#river=` link, decoded and validated once per mount. */
function readSharedRiver(): SharedState {
  const payload = riverShareFragment();
  if (!payload) return null;
  try {
    return { river: parseSharedRiver(payload) };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** A pasted share link (or bare payload) → its payload; null when the text is JSON. */
function pastedLinkPayload(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return null;
  const at = trimmed.indexOf('#');
  return riverShareFragment(at >= 0 ? trimmed.slice(at) : `river=${trimmed}`);
}

function errorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  // The validator's message opens with a registry tag meant for the console.
  return text.replace(/^\[MAP_REGISTRY\]\s*/, '');
}

export default function UserRiverPanel({ bootReady, onPlay, onOpenInWorkshop }: UserRiverPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const saved = useMemo(() => listSavedRivers(), []);
  const shared = useMemo(() => readSharedRiver(), []);

  const play = (river: UserRiver) => {
    setError(null);
    rememberRiver(river);
    onPlay(river);
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      play(await importRiverFile(file));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const loadPaste = () => {
    try {
      const payload = pastedLinkPayload(pasteText);
      play(payload ? parseSharedRiver(payload) : parseRiverText(pasteText, 'pasted-river'));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div
      className="start-menu-map-select user-river-panel"
      aria-label="Your rivers"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (bootReady) void loadFile(e.dataTransfer.files?.[0]);
      }}
    >
      <div className="start-menu-map-select-label">Your Rivers</div>
      {shared?.river && (
        <div className="user-river-shared" role="group" aria-label="Shared river">
          <div className="start-menu-map-option-main">
            <span className="start-menu-map-option-title">Shared with you: {shared.river.label}</span>
            <span className="start-menu-map-option-meta">
              {shared.river.level.segments.length} segments · {shared.river.hash}
            </span>
          </div>
          <div className="start-menu-mode-row">
            <button
              type="button"
              className="start-menu-mode-option"
              disabled={!bootReady}
              onClick={() => play(shared.river)}
            >
              Play
            </button>
            {onOpenInWorkshop && (
              <button
                type="button"
                className="start-menu-mode-option"
                onClick={() => onOpenInWorkshop(shared.river.level)}
              >
                Open in Workshop
              </button>
            )}
          </div>
        </div>
      )}
      {shared?.error && (
        <p className="user-river-error" role="alert">
          The shared river link could not be opened: {shared.error}
        </p>
      )}
      <div className="start-menu-mode-row">
        <button
          type="button"
          className="start-menu-mode-option"
          disabled={!bootReady}
          onClick={() => fileRef.current?.click()}
        >
          Load river…
        </button>
        <button
          type="button"
          className={`start-menu-mode-option ${pasteOpen ? 'active' : ''}`}
          aria-expanded={pasteOpen}
          onClick={() => setPasteOpen((open) => !open)}
        >
          Paste
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={RIVER_FILE_ACCEPT}
        hidden
        data-testid="user-river-file"
        onChange={(e) => {
          void loadFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {pasteOpen && (
        <div className="user-river-paste">
          <textarea
            className="user-river-paste-text"
            aria-label="River JSON"
            placeholder="Paste a river link, or JSON exported from the River Workshop"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={4}
          />
          <button
            type="button"
            className="start-menu-mode-option"
            disabled={!bootReady || pasteText.trim() === ''}
            onClick={loadPaste}
          >
            Play pasted river
          </button>
        </div>
      )}
      {error && (
        <p className="user-river-error" role="alert">
          {error}
        </p>
      )}
      {saved.map((river) => (
        <div key={river.id} className="start-menu-mode-row">
          <button
            type="button"
            className="start-menu-map-option"
            disabled={!bootReady}
            onClick={() => play(river)}
          >
            <div className="start-menu-map-option-main">
              <span className="start-menu-map-option-title">{river.label}</span>
              <span className="start-menu-map-option-meta">
                {river.level.segments.length} segments · {river.hash}
              </span>
            </div>
          </button>
          {onOpenInWorkshop && (
            <button
              type="button"
              className="start-menu-mode-option"
              aria-label={`Edit ${river.label} in the River Workshop`}
              onClick={() => onOpenInWorkshop(river.level)}
            >
              Edit
            </button>
          )}
        </div>
      ))}
      <p className="start-menu-map-hint">
        A .wsriver is a river saved from the River Workshop. Drop one here to run it.
      </p>
    </div>
  );
}
