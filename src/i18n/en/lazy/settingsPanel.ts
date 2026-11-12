/**
 * English for the Options panel (SettingsPanel chunk) (#566). Not in the entry: the chunk that renders
 * these keys imports this part and registers it (`registerEnglish`) at module
 * load, before its first render. es / fr hold these keys too (they are lazy anyway).
 */
export const settingsPanel = {
  // --- Options panel ---
  'settings.dialog': 'Settings',
  'settings.loading': 'Loading settings…',
  'settings.title': 'Options',
  'settings.pages': 'Options pages',
  'settings.page.general': 'General',
  'settings.page.comfort': 'Comfort & Devices',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.auto': 'Auto',
  'settings.system': 'System',
  'settings.times': '{value}×',
  'settings.degrees': '{value}°',

  'settings.language.section': 'Language',
  'settings.language.label': 'Language',
  'settings.language.note': 'Text that has no translation yet appears in English.',

  'settings.audio.section': 'Audio',
  'settings.audio.master': 'Master',
  'settings.audio.music': 'Music',
  'settings.audio.sfx': 'SFX',
  'settings.audio.volume': '{channel} Volume',

  'settings.controls.section': 'Controls',
  'settings.controls.sensitivity': 'Mouse Sensitivity',
  'settings.controls.invertY': 'Invert Y-Axis',
  'settings.bind.capturingKey': 'Press any key…',
  'settings.bind.capturingPad': 'Press a button…',
  'settings.bind.padLabel': '🎮 {binding}',
  'settings.bind.rebind': 'Rebind {action} (currently {binding})',
  'settings.bind.reset': 'Reset {action} binding to default',
  'settings.bind.padRebind': 'Gamepad button for {action} (currently {binding})',
  'settings.bind.padReset': 'Restore default gamepad button for {action}',
  'settings.bind.reserved': 'That key is reserved.',

  'settings.action.forward': 'Forward',
  'settings.action.backward': 'Backward',
  'settings.action.leftward': 'Strafe Left',
  'settings.action.rightward': 'Strafe Right',
  'settings.action.jump': 'Jump',
  'settings.action.sprint': 'Sprint',
  'settings.action.brake': 'Brake / Slide',
  'settings.action.dodge': 'Dodge',

  'settings.input.mouseLeft': 'Left Click',
  'settings.input.mouseMiddle': 'Middle Click',
  'settings.input.mouseRight': 'Right Click',
  'settings.input.space': 'Space',
  'settings.input.padBack': 'Back',
  'settings.input.padStart': 'Start',
  'settings.input.dpadUp': 'D-pad ↑',
  'settings.input.dpadDown': 'D-pad ↓',
  'settings.input.dpadLeft': 'D-pad ←',
  'settings.input.dpadRight': 'D-pad →',
  'settings.input.leftStick': 'Left Stick {arrow}',
  'settings.input.rightStick': 'Right Stick {arrow}',
  'settings.input.button': 'Button {n}',
  'settings.input.axis': 'Axis {n}{sign}',

  'settings.graphics.section': 'Graphics',
  'settings.graphics.quality': 'Quality',
  'settings.quality.low': 'Low',
  'settings.quality.med': 'Medium',
  'settings.quality.high': 'High',
  'settings.graphics.note':
    'Effect toggles apply immediately. Resolution changes apply on next map load. Water surface displacement is off on Low.',

  'settings.physics.section': 'Physics',
  'settings.physics.worker': 'Physics worker',
  'settings.physics.note':
    'Auto runs Rapier and the native water forces in a worker wherever the browser supports it. Turn it off if the raft feels wrong; applies on next map load.',

  'settings.comfort.section': 'Comfort',
  'settings.comfort.fov': 'Field of view',
  'settings.comfort.fovKick': 'Sprint FOV kick',
  'settings.comfort.shake': 'Camera shake',
  'settings.comfort.vignette': 'Vignette',
  'settings.comfort.speedEffects': 'Speed blur / chromatic aberration',
  'settings.comfort.reducedMotion': 'Reduced motion',
  'settings.comfort.reducedNote':
    'Reduced motion switches off camera shake, the sprint FOV kick and speed blur.',
  'settings.comfort.systemNote': "System follows your device's setting.",
  'settings.comfort.systemNoteActive': "System follows your device's setting (currently reducing motion).",

  'settings.touch.section': 'Touch',
  'settings.touch.leftHanded': 'Left-handed layout',

  'settings.pad.section': 'Gamepad',
  'settings.pad.deadzone': 'Stick dead zone',
  'settings.pad.curve': 'Response curve',
  'settings.pad.linear': 'Linear',
  'settings.pad.vibration': 'Vibration',
  'settings.pad.vibrationStrength': 'Vibration strength',
  'settings.pad.note':
    'Rebind gamepad buttons and sticks on the General page. Triggers are the raft paddles; Start pauses.',

  'settings.reset': 'Reset to Defaults',
  'settings.back': 'Back',
} as const;
