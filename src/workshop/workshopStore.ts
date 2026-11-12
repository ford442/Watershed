/**
 * workshopStore.ts — River Workshop state: one zustand store, `LevelData` as
 * the source of truth, wrapped in zundo for undo / redo (River Workshop A.2).
 *
 * History covers the level only (`partialize`): selection, viewport mode and
 * the remembered camera are UI state and never become undo steps. It is
 * capped at `HISTORY_LIMIT` entries and coalesced per gesture: consecutive
 * edits that carry the same `coalesce` key (one slider drag, one spline-handle
 * drag, typing in one field) fold into a single step until `endGesture()` —
 * pointer-up / blur — or `COALESCE_WINDOW_MS` of quiet closes it.
 *
 * The store is module state in the Workshop's lazy chunk, so it outlives the
 * Workshop's mount: a Test run unmounts the Workshop, plays, and the return
 * finds the same level, the same history and the same camera.
 */

import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { temporal, type TemporalState } from 'zundo';
import type { LevelData } from '../systems/map/MapSystem.types';
import {
  applySegmentEdit,
  applyWorldBiome,
  levelToEditorSegments,
  type EditorSegmentConfig,
} from './editorSegments';

export const HISTORY_LIMIT = 100;
/** Same-key edits closer together than this fold into one undo step. */
export const COALESCE_WINDOW_MS = 1000;

export type ViewportMode = '3d' | 'top' | 'side';

export interface WorkshopCamera {
  position: [number, number, number];
  target: [number, number, number];
}

interface WorkshopData {
  /** The river being authored; null until a start-from pick. */
  level: LevelData | null;
  selectedSegmentIndex: number;
  viewportMode: ViewportMode;
  /** Where the camera was when the Workshop last unmounted (Test run, Close). */
  camera: WorkshopCamera | null;
}

export interface EditOptions {
  /** Edits with the same key fold into one undo step until the gesture ends. */
  coalesce?: string;
}

export interface WorkshopState extends WorkshopData {
  /** Replace the level (a start-from pick, a file, a shared link). One undo step. */
  loadLevel: (level: LevelData) => void;
  /** Any change to the level, as a pure function of the current one. */
  editLevel: (edit: (level: LevelData) => LevelData, options?: EditOptions) => void;
  updateSegment: (index: number, updates: Partial<EditorSegmentConfig>, options?: EditOptions) => void;
  setWorldBiome: (biome: string, options?: { clearOverrides?: boolean }) => void;
  selectSegment: (index: number) => void;
  setViewportMode: (mode: ViewportMode) => void;
  setCamera: (camera: WorkshopCamera) => void;
  /** Close the open gesture: the next edit starts a new undo step. */
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
}

type HistoryState = Pick<WorkshopData, 'level'>;

// --- per-gesture coalescing -------------------------------------------------

let pendingKey: string | null = null;
let openKey: string | null = null;
let openAt = -Infinity;
let now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : 0);

/** Test seam: the clock the coalescing window reads. */
export function setWorkshopClockForTests(clock: (() => number) | null): void {
  now = clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : 0));
}

function closeGesture(): void {
  openKey = null;
  openAt = -Infinity;
}

const INITIAL: WorkshopData = {
  level: null,
  selectedSegmentIndex: 0,
  viewportMode: '3d',
  camera: null,
};

function createWorkshopStore() {
  return createStore<WorkshopState>()(
    temporal(
      (set, get) => {
        const edit = (next: (level: LevelData) => LevelData, options?: EditOptions) => {
          const level = get().level;
          if (!level) return;
          const updated = next(level);
          if (updated === level) return;
          pendingKey = options?.coalesce ?? null;
          try {
            set({ level: updated });
          } finally {
            pendingKey = null;
          }
        };
        return {
          ...INITIAL,
          loadLevel: (level) => {
            closeGesture();
            set({ level, selectedSegmentIndex: 0 });
          },
          editLevel: edit,
          updateSegment: (index, updates, options) => edit((l) => applySegmentEdit(l, index, updates), options),
          setWorldBiome: (biome, options) =>
            edit((l) => applyWorldBiome(l, biome, options?.clearOverrides ?? false)),
          selectSegment: (index) => {
            closeGesture();
            set({ selectedSegmentIndex: index });
          },
          setViewportMode: (viewportMode) => set({ viewportMode }),
          setCamera: (camera) => set({ camera }),
          endGesture: closeGesture,
          undo: () => {
            closeGesture();
            workshopHistory().undo();
            clampSelection();
          },
          redo: () => {
            closeGesture();
            workshopHistory().redo();
            clampSelection();
          },
        };
      },
      {
        partialize: (state): HistoryState => ({ level: state.level }),
        // UI-only sets (selection, camera) leave the level as it was: no step.
        equality: (past, current) => past.level === current.level,
        limit: HISTORY_LIMIT,
        handleSet: (setPast) => (pastState, replace, currentState, deltaState) => {
          // zundo types the inner setter as setState; at run time it is the
          // temporal store's _handleSet, which takes all four arguments.
          const handleSet = setPast as unknown as (
            past: typeof pastState,
            replaceFlag: Parameters<typeof setPast>[1],
            current: typeof currentState,
            delta: typeof deltaState,
          ) => void;
          const key = pendingKey;
          const t = now();
          if (key !== null && key === openKey && t - openAt <= COALESCE_WINDOW_MS) {
            // Same gesture: the step recorded at its first edit already holds
            // the level from before it; this edit only moves the present.
            openAt = t;
            return;
          }
          openKey = key;
          openAt = t;
          handleSet(pastState, replace, currentState, deltaState);
        },
      },
    ),
  );
}

export const workshopStore = createWorkshopStore();

function workshopHistory(): TemporalState<HistoryState> {
  return workshopStore.temporal.getState();
}

function clampSelection(): void {
  const { level, selectedSegmentIndex } = workshopStore.getState();
  const count = level?.segments.length ?? 0;
  if (count > 0 && selectedSegmentIndex >= count) {
    workshopStore.setState({ selectedSegmentIndex: count - 1 });
  }
}

/** Hook over the Workshop store. */
export function useWorkshop<T>(selector: (state: WorkshopState) => T): T {
  return useStore(workshopStore, selector);
}

/** Hook over the history (can undo / redo, step counts). */
export function useWorkshopHistory<T>(selector: (state: TemporalState<HistoryState>) => T): T {
  return useStore(workshopStore.temporal, selector);
}

/** The inspector rows of the current level (memoised per level object). */
export function selectSegments(state: WorkshopState): EditorSegmentConfig[] {
  return state.level ? levelToEditorSegments(state.level) : EMPTY_ROWS;
}
const EMPTY_ROWS: EditorSegmentConfig[] = [];

/** Test seam: back to an empty Workshop with no history. */
export function resetWorkshopForTests(): void {
  closeGesture();
  pendingKey = null;
  workshopStore.setState({ ...INITIAL });
  workshopHistory().clear();
}
