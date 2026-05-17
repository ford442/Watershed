import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useDebugStages } from './debugStages';
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
    const disabledPanel = render(
      <DebugPanel
        debug={{
          debugEnabled: false,
          stageConfig: {} as any,
          enabledStages: {} as any,
          stageRuntime: {} as any,
          isStageEnabled: jest.fn(),
          setStageEnabled: jest.fn(),
          runStage: jest.fn(),
          setStageLoading: jest.fn(),
          setStageSuccess: jest.fn(),
          setStageFailure: jest.fn(),
        }}
      />
    );

    expect(disabledPanel.queryByLabelText('Debug Stages Panel')).not.toBeInTheDocument();
  });
});

