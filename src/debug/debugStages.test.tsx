import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DebugStageController, DEBUG_STAGES, useDebugStages } from './debugStages';
import { DebugPanel } from '../components/DebugPanel';

const STORAGE_KEY = 'watershed.debug.stages';

describe('debug stage system', () => {
  const originalUrl = window.location.href;

  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/?debug=1');
  });

  afterEach(() => {
    window.history.replaceState({}, '', originalUrl);
  });

  it('persists stage toggles to localStorage and URL params', async () => {
    const Harness = () => {
      const debug = useDebugStages();
      return (
        <button onClick={() => debug.setStageEnabled('audio', false)}>
          {String(debug.enabledStages.audio)}
        </button>
      );
    };

    render(<Harness />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
      expect(stored.audio).toBe(false);
    });

    expect(window.location.search).toContain('debug=1');
    expect(window.location.search).toContain('debugStages=');
    expect(window.location.search).not.toContain('audio');
  });

  it('shows debug panel only when debug mode is enabled', () => {
    const mockController: DebugStageController = {
      debugEnabled: false,
      stageConfig: DEBUG_STAGES,
      enabledStages: Object.keys(DEBUG_STAGES).reduce((acc, key) => {
        acc[key as keyof typeof DEBUG_STAGES] = true;
        return acc;
      }, {} as DebugStageController['enabledStages']),
      stageRuntime: Object.keys(DEBUG_STAGES).reduce((acc, key) => {
        acc[key as keyof typeof DEBUG_STAGES] = { status: 'idle' };
        return acc;
      }, {} as DebugStageController['stageRuntime']),
      isStageEnabled: vi.fn(() => true),
      setStageEnabled: vi.fn(),
      runStage: vi.fn(),
      setStageLoading: vi.fn(),
      setStageSuccess: vi.fn(),
      setStageFailure: vi.fn(),
    };

    const disabledPanel = render(
      <DebugPanel debug={mockController} />
    );

    expect(disabledPanel.queryByLabelText('Debug Stages Panel')).not.toBeInTheDocument();
  });

  it('renders debug panel with stage labels when enabled', () => {
    const Harness = () => {
      const debug = useDebugStages();
      return <DebugPanel debug={debug} />;
    };

    render(<Harness />);
    expect(screen.getByLabelText('Debug Stages Panel')).toBeInTheDocument();

    // Stages are in a collapsible section — expand it first
    fireEvent.click(screen.getByRole('button', { name: /load stages/i }));
    expect(screen.getByText('App Bootstrap')).toBeInTheDocument();
    expect(screen.getByText('Physics')).toBeInTheDocument();
  });

  it('toggles physics debug checkbox through callback', () => {
    const mockController: DebugStageController = {
      debugEnabled: true,
      stageConfig: DEBUG_STAGES,
      enabledStages: Object.keys(DEBUG_STAGES).reduce((acc, key) => {
        acc[key as keyof typeof DEBUG_STAGES] = true;
        return acc;
      }, {} as DebugStageController['enabledStages']),
      stageRuntime: Object.keys(DEBUG_STAGES).reduce((acc, key) => {
        acc[key as keyof typeof DEBUG_STAGES] = { status: 'idle' };
        return acc;
      }, {} as DebugStageController['stageRuntime']),
      isStageEnabled: vi.fn(() => true),
      setStageEnabled: vi.fn(),
      runStage: vi.fn(),
      setStageLoading: vi.fn(),
      setStageSuccess: vi.fn(),
      setStageFailure: vi.fn(),
    };
    const onTogglePhysicsDebug = vi.fn();

    render(
      <DebugPanel
        debug={mockController}
        physicsDebug={false}
        onTogglePhysicsDebug={onTogglePhysicsDebug}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /show physics hud/i }));
    expect(onTogglePhysicsDebug).toHaveBeenCalledWith(true);
  });
});
