import { useCallback, useMemo, useRef, useState } from 'react';

export const DEBUG_STAGES = {
  appBootstrap: { label: 'App Bootstrap', category: 'core', defaultEnabled: true },
  stateManagement: { label: 'State Management', category: 'state', defaultEnabled: true },
  dataProcessing: { label: 'Data Processing', category: 'data', defaultEnabled: true },
  visualization: { label: 'Visualization', category: 'render', defaultEnabled: true },
  physics: { label: 'Physics', category: 'simulation', defaultEnabled: true },
  worldSystems: { label: 'World Systems', category: 'systems', defaultEnabled: true },
  audio: { label: 'Audio', category: 'systems', defaultEnabled: true },
  postProcessing: { label: 'Post Processing', category: 'render', defaultEnabled: true },
  uiOverlay: { label: 'UI Overlay', category: 'ui', defaultEnabled: true },
  reachStreaming: { label: 'Reach/Level Streaming', category: 'data', defaultEnabled: true },
} as const;

export type DebugStageId = keyof typeof DEBUG_STAGES;
export type DebugStageStatus = 'idle' | 'loading' | 'success' | 'failure' | 'disabled';

export interface DebugStageRuntime {
  status: DebugStageStatus;
  durationMs?: number;
  error?: string;
}

export interface DebugStageController {
  debugEnabled: boolean;
  stageConfig: typeof DEBUG_STAGES;
  enabledStages: Record<DebugStageId, boolean>;
  stageRuntime: Record<DebugStageId, DebugStageRuntime>;
  isStageEnabled: (stageId: DebugStageId) => boolean;
  setStageEnabled: (stageId: DebugStageId, enabled: boolean) => void;
  runStage: <T>(stageId: DebugStageId, stageFn: () => T | Promise<T>) => Promise<T | undefined>;
  setStageLoading: (stageId: DebugStageId) => void;
  setStageSuccess: (stageId: DebugStageId) => void;
  setStageFailure: (stageId: DebugStageId, error: unknown) => void;
}

const STAGE_STORAGE_KEY = 'watershed.debug.stages';

const parseDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('debug');
  return raw === '1' || raw === 'true';
};

const parseUrlStageOverrides = (): Partial<Record<DebugStageId, boolean>> => {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('debugStages');
  if (!raw) return {};
  const enabledSet = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  const entries = Object.keys(DEBUG_STAGES).map((key) => [key, enabledSet.has(key)]);
  return Object.fromEntries(entries) as Partial<Record<DebugStageId, boolean>>;
};

const parseStoredStages = (): Partial<Record<DebugStageId, boolean>> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STAGE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    const result: Partial<Record<DebugStageId, boolean>> = {};
    (Object.keys(DEBUG_STAGES) as DebugStageId[]).forEach((stageId) => {
      if (typeof parsed[stageId] === 'boolean') {
        result[stageId] = parsed[stageId];
      }
    });
    return result;
  } catch (error) {
    console.warn('[DebugStage] Failed to parse stage preferences:', error);
    return {};
  }
};

const getDefaultEnabledStages = (): Record<DebugStageId, boolean> =>
  (Object.keys(DEBUG_STAGES) as DebugStageId[]).reduce((acc, stageId) => {
    acc[stageId] = DEBUG_STAGES[stageId].defaultEnabled;
    return acc;
  }, {} as Record<DebugStageId, boolean>);

const initRuntimeState = (
  enabledStages: Record<DebugStageId, boolean>
): Record<DebugStageId, DebugStageRuntime> =>
  (Object.keys(DEBUG_STAGES) as DebugStageId[]).reduce((acc, stageId) => {
    acc[stageId] = {
      status: enabledStages[stageId] ? 'idle' : 'disabled',
    };
    return acc;
  }, {} as Record<DebugStageId, DebugStageRuntime>);

const normalizeError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
};

export function useDebugStages(): DebugStageController {
  const debugEnabled = parseDebugEnabled();
  const [enabledStages, setEnabledStages] = useState<Record<DebugStageId, boolean>>(() => {
    const defaults = getDefaultEnabledStages();
    if (!debugEnabled) return defaults;
    return {
      ...defaults,
      ...parseStoredStages(),
      ...parseUrlStageOverrides(),
    };
  });
  const [stageRuntime, setStageRuntime] = useState<Record<DebugStageId, DebugStageRuntime>>(
    () => initRuntimeState(enabledStages)
  );
  const startedAtRef = useRef<Partial<Record<DebugStageId, number>>>({});

  const persistEnabledStages = useCallback((stages: Record<DebugStageId, boolean>) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STAGE_STORAGE_KEY, JSON.stringify(stages));
      if (debugEnabled) {
        const params = new URLSearchParams(window.location.search);
        const enabled = (Object.keys(stages) as DebugStageId[]).filter((id) => stages[id]);
        params.set('debugStages', enabled.join(','));
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
      }
    } catch (error) {
      console.warn('[DebugStage] Failed to persist stage preferences:', error);
    }
  }, [debugEnabled]);

  const isStageEnabled = useCallback((stageId: DebugStageId) => enabledStages[stageId], [enabledStages]);

  const setStageEnabled = useCallback((stageId: DebugStageId, enabled: boolean) => {
    setEnabledStages((prev) => {
      const next = { ...prev, [stageId]: enabled };
      persistEnabledStages(next);
      return next;
    });
    setStageRuntime((prev) => ({
      ...prev,
      [stageId]: {
        status: enabled ? 'idle' : 'disabled',
      },
    }));
  }, [persistEnabledStages]);

  const setStageLoading = useCallback((stageId: DebugStageId) => {
    if (!enabledStages[stageId]) return;
    startedAtRef.current[stageId] = performance.now();
    setStageRuntime((prev) => ({
      ...prev,
      [stageId]: { status: 'loading' },
    }));
    if (debugEnabled) {
      console.info(`[DebugStage] ⏳ ${DEBUG_STAGES[stageId].label}`);
    }
  }, [debugEnabled, enabledStages]);

  const setStageSuccess = useCallback((stageId: DebugStageId) => {
    if (!enabledStages[stageId]) return;
    const startedAt = startedAtRef.current[stageId];
    const durationMs = startedAt ? Math.round(performance.now() - startedAt) : undefined;
    setStageRuntime((prev) => ({
      ...prev,
      [stageId]: { status: 'success', durationMs },
    }));
    if (debugEnabled) {
      console.info(`[DebugStage] ✓ ${DEBUG_STAGES[stageId].label}${durationMs !== undefined ? ` (${durationMs}ms)` : ''}`);
    }
  }, [debugEnabled, enabledStages]);

  const setStageFailure = useCallback((stageId: DebugStageId, error: unknown) => {
    const normalized = normalizeError(error);
    const startedAt = startedAtRef.current[stageId];
    const durationMs = startedAt ? Math.round(performance.now() - startedAt) : undefined;
    setStageRuntime((prev) => ({
      ...prev,
      [stageId]: { status: 'failure', error: normalized, durationMs },
    }));
    console.error(`[DebugStage] ✗ ${DEBUG_STAGES[stageId].label}:`, error);
  }, []);

  const runStage = useCallback(async <T,>(stageId: DebugStageId, stageFn: () => T | Promise<T>) => {
    if (!enabledStages[stageId]) {
      setStageRuntime((prev) => ({
        ...prev,
        [stageId]: { status: 'disabled' },
      }));
      return undefined;
    }

    setStageLoading(stageId);
    try {
      const result = await stageFn();
      setStageSuccess(stageId);
      return result;
    } catch (error) {
      setStageFailure(stageId, error);
      return undefined;
    }
  }, [enabledStages, setStageFailure, setStageLoading, setStageSuccess]);

  return useMemo(
    () => ({
      debugEnabled,
      stageConfig: DEBUG_STAGES,
      enabledStages,
      stageRuntime,
      isStageEnabled,
      setStageEnabled,
      runStage,
      setStageLoading,
      setStageSuccess,
      setStageFailure,
    }),
    [
      debugEnabled,
      enabledStages,
      stageRuntime,
      isStageEnabled,
      setStageEnabled,
      runStage,
      setStageLoading,
      setStageSuccess,
      setStageFailure,
    ]
  );
}

