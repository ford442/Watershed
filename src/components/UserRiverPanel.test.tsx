import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import lumberLevel from '../maps/lumber_flume.json';
import UserRiverPanel from './UserRiverPanel';
import { clearUserLevelsForTests, listUserLevels, saveUserLevel } from '../systems/map/userLevelStore';
import { shareRiver } from '../systems/map/riverShare';
import type { LevelData } from '../systems/map/MapSystem';

beforeEach(() => clearUserLevelsForTests());
afterEach(() => window.history.replaceState({}, '', window.location.pathname));

function sharedLink(): string {
  const result = shareRiver(lumberLevel as unknown as LevelData, 'https://example.test/');
  if (result.kind !== 'link') throw new Error('lumber should fit a link');
  return result.url;
}

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

  it('offers a #river= link as Play / Open in Workshop', () => {
    window.history.replaceState({}, '', `${window.location.pathname}${new URL(sharedLink()).hash}`);
    const onPlay = vi.fn();
    const onOpenInWorkshop = vi.fn();
    render(<UserRiverPanel bootReady onPlay={onPlay} onOpenInWorkshop={onOpenInWorkshop} />);
    expect(screen.getByText(`Shared with you: ${lumberLevel.metadata.name}`)).toBeTruthy();
    fireEvent.click(screen.getByText('Open in Workshop'));
    expect(onOpenInWorkshop).toHaveBeenCalledWith(lumberLevel);
    fireEvent.click(screen.getByText('Play'));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('a damaged #river= link says why instead of crashing the menu', () => {
    window.history.replaceState({}, '', `${window.location.pathname}#river=@@@`);
    render(<UserRiverPanel bootReady onPlay={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toMatch(/could not be opened.*damaged/);
  });

  it('a pasted share link plays', () => {
    const onPlay = vi.fn();
    render(<UserRiverPanel bootReady onPlay={onPlay} />);
    fireEvent.click(screen.getByText('Paste'));
    fireEvent.change(screen.getByLabelText('River JSON'), { target: { value: sharedLink() } });
    fireEvent.click(screen.getByText('Play pasted river'));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay.mock.calls[0][0].level).toEqual(lumberLevel);
  });

  it('saved rivers open in the Workshop', () => {
    saveUserLevel('my-flume', lumberLevel);
    const onOpenInWorkshop = vi.fn();
    render(<UserRiverPanel bootReady onPlay={vi.fn()} onOpenInWorkshop={onOpenInWorkshop} />);
    fireEvent.click(screen.getByLabelText(`Edit ${lumberLevel.metadata.name} in the River Workshop`));
    expect(onOpenInWorkshop).toHaveBeenCalledTimes(1);
  });
});
