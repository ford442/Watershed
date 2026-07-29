import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel';
import { useSettingsStore, DEFAULT_SETTINGS } from '../systems/useSettingsStore';
import { DEFAULT_BINDINGS } from '../systems/settingsDerive';

beforeEach(() => {
  useSettingsStore.setState({
    masterVolume: DEFAULT_SETTINGS.masterVolume,
    musicVolume: DEFAULT_SETTINGS.musicVolume,
    sfxVolume: DEFAULT_SETTINGS.sfxVolume,
    mouseSensitivity: DEFAULT_SETTINGS.mouseSensitivity,
    invertY: DEFAULT_SETTINGS.invertY,
    quality: DEFAULT_SETTINGS.quality,
    bindings: { ...DEFAULT_BINDINGS },
    _hasHydrated: true, // simulate post-hydration
  });
});

describe('SettingsPanel', () => {
  it('shows a loading state before hydration', () => {
    useSettingsStore.setState({ _hasHydrated: false });
    render(<SettingsPanel onClose={() => {}} />);
    expect(screen.getByText(/loading settings/i)).toBeInTheDocument();
  });

  it('renders audio, controls, and graphics sections when hydrated', () => {
    render(<SettingsPanel onClose={() => {}} />);
    expect(screen.getByLabelText('Master Volume')).toBeInTheDocument();
    expect(screen.getByLabelText('Mouse Sensitivity')).toBeInTheDocument();
    expect(screen.getByText('Quality')).toBeInTheDocument();
  });

  it('updates the store live when a slider changes', () => {
    render(<SettingsPanel onClose={() => {}} />);
    const music = screen.getByLabelText('Music Volume') as HTMLInputElement;
    fireEvent.change(music, { target: { value: '0.3' } });
    expect(useSettingsStore.getState().musicVolume).toBeCloseTo(0.3);
  });

  it('toggles invert-Y', () => {
    render(<SettingsPanel onClose={() => {}} />);
    const toggle = screen.getByRole('switch', { name: /invert y-axis/i });
    fireEvent.click(toggle);
    expect(useSettingsStore.getState().invertY).toBe(true);
  });

  it('changes quality live', () => {
    render(<SettingsPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Low' }));
    expect(useSettingsStore.getState().quality).toBe('low');
  });

  it('captures a KEY binding via the capture widget', () => {
    render(<SettingsPanel onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/Rebind Jump/i));
    // Next keydown becomes the binding.
    fireEvent.keyDown(window, { code: 'KeyJ' });
    expect(useSettingsStore.getState().bindings.jump).toEqual({ kind: 'key', code: 'KeyJ' });
  });

  it('captures a MOUSE binding via the capture widget', () => {
    render(<SettingsPanel onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/Rebind Forward/i));
    fireEvent.mouseDown(window, { button: 2 });
    expect(useSettingsStore.getState().bindings.forward).toEqual({ kind: 'mouse', code: 'Mouse2' });
  });

  it('refuses a reserved key and shows an error', () => {
    render(<SettingsPanel onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/Rebind Jump/i));
    fireEvent.keyDown(window, { code: 'F5' });
    expect(useSettingsStore.getState().bindings.jump).toEqual(DEFAULT_BINDINGS.jump);
    expect(screen.getByRole('alert')).toHaveTextContent(/reserved/i);
  });

  it('dismisses back to the parent via onClose', () => {
    const onClose = vi.fn();
    render(<SettingsPanel onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
