import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel';
import { useSettingsStore, DEFAULT_SETTINGS } from '../systems/settings/useSettingsStore';
import { DEFAULT_BINDINGS, DEFAULT_PAD_BINDINGS } from '../systems/settings/settingsDerive';

beforeEach(() => {
  useSettingsStore.setState({
    masterVolume: DEFAULT_SETTINGS.masterVolume,
    musicVolume: DEFAULT_SETTINGS.musicVolume,
    sfxVolume: DEFAULT_SETTINGS.sfxVolume,
    mouseSensitivity: DEFAULT_SETTINGS.mouseSensitivity,
    invertY: DEFAULT_SETTINGS.invertY,
    quality: DEFAULT_SETTINGS.quality,
    bindings: { ...DEFAULT_BINDINGS },
    padBindings: { ...DEFAULT_PAD_BINDINGS },
    fov: DEFAULT_SETTINGS.fov,
    fovKick: DEFAULT_SETTINGS.fovKick,
    cameraShake: DEFAULT_SETTINGS.cameraShake,
    speedEffects: DEFAULT_SETTINGS.speedEffects,
    vignetteStrength: DEFAULT_SETTINGS.vignetteStrength,
    reducedMotion: DEFAULT_SETTINGS.reducedMotion,
    leftHanded: DEFAULT_SETTINGS.leftHanded,
    hapticsEnabled: DEFAULT_SETTINGS.hapticsEnabled,
    gamepadDeadzone: DEFAULT_SETTINGS.gamepadDeadzone,
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

describe('SettingsPanel — Comfort & Devices page (#486 D)', () => {
  const openComfort = () => {
    render(<SettingsPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: /comfort/i }));
  };

  it('has the comfort controls on their own page', () => {
    render(<SettingsPanel onClose={() => {}} />);
    expect(screen.queryByLabelText('Field of view')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /comfort/i }));
    expect(screen.getByLabelText('Field of view')).toBeInTheDocument();
    expect(screen.getByLabelText('Camera shake')).toBeInTheDocument();
    expect(screen.getByLabelText('Sprint FOV kick')).toBeInTheDocument();
    expect(screen.getByLabelText('Vignette')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /speed blur/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /left-handed/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /vibration$/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Stick dead zone')).toBeInTheDocument();
    expect(screen.getByLabelText('Response curve')).toBeInTheDocument();
  });

  it('FOV is 70–110 and writes the store live', () => {
    openComfort();
    const fov = screen.getByLabelText('Field of view') as HTMLInputElement;
    expect(fov.min).toBe('70');
    expect(fov.max).toBe('110');
    fireEvent.change(fov, { target: { value: '95' } });
    expect(useSettingsStore.getState().fov).toBe(95);
  });

  it('camera shake goes 0–100 % and every toggle writes through', () => {
    openComfort();
    fireEvent.change(screen.getByLabelText('Camera shake'), { target: { value: '0.4' } });
    expect(useSettingsStore.getState().cameraShake).toBeCloseTo(0.4);
    fireEvent.click(screen.getByRole('switch', { name: /speed blur/i }));
    expect(useSettingsStore.getState().speedEffects).toBe(false);
    fireEvent.click(screen.getByRole('switch', { name: /left-handed/i }));
    expect(useSettingsStore.getState().leftHanded).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: /vibration$/i }));
    expect(useSettingsStore.getState().hapticsEnabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Stick dead zone'), { target: { value: '0.3' } });
    expect(useSettingsStore.getState().gamepadDeadzone).toBeCloseTo(0.3);
  });

  it('reduced motion is a System / On / Off choice', () => {
    openComfort();
    fireEvent.click(screen.getByRole('button', { name: 'On' }));
    expect(useSettingsStore.getState().reducedMotion).toBe('on');
    fireEvent.click(screen.getByRole('button', { name: 'System' }));
    expect(useSettingsStore.getState().reducedMotion).toBe('system');
  });
});

describe('SettingsPanel — gamepad rebinding (#486 B)', () => {
  it('shows each action\'s gamepad binding by name next to the keyboard one', () => {
    render(<SettingsPanel onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /Gamepad button for Jump \(currently A\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gamepad button for Forward \(currently Left Stick ↑\)/ })).toBeInTheDocument();
  });

  it('captures the next gamepad button after the pad is released, and binds it', async () => {
    vi.useFakeTimers();
    let pressed = true;
    const pad = () => ({
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === 3 && pressed, value: i === 3 && pressed ? 1 : 0 })),
    });
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad()] });

    render(<SettingsPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Gamepad button for Dodge/ }));
    // Button 3 is still held from the click: not a capture.
    await vi.advanceTimersByTimeAsync(64);
    expect(useSettingsStore.getState().padBindings.dodge.code).toBe('Button2');
    pressed = false;
    await vi.advanceTimersByTimeAsync(32);
    pressed = true;
    await vi.advanceTimersByTimeAsync(32);
    expect(useSettingsStore.getState().padBindings.dodge).toEqual({ kind: 'gamepad-button', code: 'Button3' });
    expect(useSettingsStore.getState().bindings.dodge).toEqual(DEFAULT_BINDINGS.dodge);
    vi.useRealTimers();
  });
});
