import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MOVEMENT_READOUT_KEY, MovementReadout } from './MovementReadout';
import { useGameStore } from '../systems/GameState';

describe('MovementReadout', () => {
  beforeEach(() => {
    window.sessionStorage.removeItem(MOVEMENT_READOUT_KEY);
    window.history.replaceState(null, '', '/');
    useGameStore.setState({
      playerPosition: { x: 1.25, y: -6, z: -10 },
      currentSpeed: 4.5,
      distance: 12.4,
    });
  });

  it('is hidden by default and F3 toggles it', async () => {
    render(<MovementReadout />);
    expect(screen.queryByTestId('move-readout')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { code: 'F3' });
    expect(await screen.findByTestId('move-readout')).toBeInTheDocument();

    fireEvent.keyDown(window, { code: 'F3' });
    expect(screen.queryByTestId('move-readout')).not.toBeInTheDocument();
  });

  it('keeps the F3 choice across a remount', async () => {
    const first = render(<MovementReadout />);
    fireEvent.keyDown(window, { code: 'F3' });
    expect(await screen.findByTestId('move-readout')).toBeInTheDocument();
    first.unmount();

    render(<MovementReadout />);
    expect(await screen.findByTestId('move-readout')).toBeInTheDocument();
    fireEvent.keyDown(window, { code: 'F3' });
    expect(screen.queryByTestId('move-readout')).not.toBeInTheDocument();
  });

  it('opens at boot under ?debug=1 and shows position, speed and distance', async () => {
    window.history.replaceState(null, '', '/?debug=1');
    render(<MovementReadout />);
    const panel = await screen.findByTestId('move-readout');
    expect(panel).toHaveTextContent('1.3'); // x, one decimal
    expect(panel).toHaveTextContent('-10.0'); // z
    expect(panel).toHaveTextContent('4.5'); // speed
    expect(panel).toHaveTextContent('12'); // distance
  });

  it('follows the store as the player moves', async () => {
    window.history.replaceState(null, '', '/?debug=1');
    render(<MovementReadout />);
    act(() => {
      useGameStore.setState({ playerPosition: { x: 1.25, y: -6, z: -42.5 }, currentSpeed: 9 });
    });
    const panel = await screen.findByTestId('move-readout');
    expect(panel).toHaveTextContent('-42.5');
    expect(panel).toHaveTextContent('9.0');
  });

  it('lights a chip while its key is held, for WASD and arrows alike', async () => {
    window.history.replaceState(null, '', '/?debug=1');
    render(<MovementReadout />);
    await screen.findByTestId('move-readout');
    const chip = (label: string) => screen.getByText(label);

    fireEvent.keyDown(window, { code: 'KeyW' });
    expect(chip('W')).toHaveClass('move-readout__key--down');
    expect(chip('↑')).not.toHaveClass('move-readout__key--down');

    fireEvent.keyDown(window, { code: 'ArrowLeft' });
    expect(chip('←')).toHaveClass('move-readout__key--down');

    fireEvent.keyUp(window, { code: 'KeyW' });
    expect(chip('W')).not.toHaveClass('move-readout__key--down');

    fireEvent.mouseDown(window, { button: 2 });
    expect(chip('M2')).toHaveClass('move-readout__key--down');
    fireEvent.blur(window);
    expect(chip('M2')).not.toHaveClass('move-readout__key--down');
    expect(chip('←')).not.toHaveClass('move-readout__key--down');
  });
});
