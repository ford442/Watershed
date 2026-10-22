import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import lumberLevel from '../maps/lumber_flume.json';
import UserRiverPanel from './UserRiverPanel';
import { clearUserLevelsForTests, listUserLevels, saveUserLevel } from '../systems/map/userLevelStore';

beforeEach(() => clearUserLevelsForTests());

describe('UserRiverPanel', () => {
  it('plays a saved river', () => {
    saveUserLevel('my-flume', lumberLevel);
    const onPlay = vi.fn();
    render(<UserRiverPanel bootReady onPlay={onPlay} />);
    fireEvent.click(screen.getByText(lumberLevel.metadata.name));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay.mock.calls[0][0].id).toBe('my-flume');
  });

  it('a pasted river plays and is remembered; a broken one says why', () => {
    const onPlay = vi.fn();
    render(<UserRiverPanel bootReady onPlay={onPlay} />);
    fireEvent.click(screen.getByText('Paste'));
    const box = screen.getByLabelText('River JSON');

    fireEvent.change(box, { target: { value: '{"metadata":' } });
    fireEvent.click(screen.getByText('Play pasted river'));
    expect(screen.getByRole('alert').textContent).toMatch(/not JSON/);
    expect(onPlay).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: JSON.stringify(lumberLevel) } });
    fireEvent.click(screen.getByText('Play pasted river'));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(listUserLevels().map((e) => e.id)).toEqual(['pasted-river']);
  });
});
