/**
 * UserRiverPanel — the StartMenu's "Your rivers": load a `.wsriver` (file,
 * drop or paste), or play one the editor saved.
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
  rememberRiver,
} from '../systems/map/userRiverImport';
import type { UserRiver } from '../systems/map/userRiverSession';

interface UserRiverPanelProps {
  bootReady: boolean;
  onPlay: (river: UserRiver) => void;
}

function errorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  // The validator's message opens with a registry tag meant for the console.
  return text.replace(/^\[MAP_REGISTRY\]\s*/, '');
}

export default function UserRiverPanel({ bootReady, onPlay }: UserRiverPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const saved = useMemo(() => listSavedRivers(), []);

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
      play(parseRiverText(pasteText, 'pasted-river'));
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
            placeholder="Paste a river exported from the level editor"
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
        <button
          key={river.id}
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
      ))}
      <p className="start-menu-map-hint">
        A .wsriver is the JSON the level editor exports. Drop one here to run it.
      </p>
    </div>
  );
}
