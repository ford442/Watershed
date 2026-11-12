/**
 * English for the pause menu (PauseMenu chunk) (#566). Not in the entry: the chunk that renders
 * these keys imports this part and registers it (`registerEnglish`) at module
 * load, before its first render. es / fr hold these keys too (they are lazy anyway).
 */
export const pauseMenu = {
  // --- Pause menu ---
  'pause.title': 'PAUSED',
  'pause.resume': 'RESUME',
  'pause.resumeLabel': 'Resume Game',
  'pause.restart': 'RESTART',
  'pause.restartLabel': 'Restart Game',
  'pause.options': 'OPTIONS',
  'pause.optionsLabel': 'Open Options',
  'pause.ghostOn': 'GHOST: ON',
  'pause.ghostOff': 'GHOST: OFF',
  'pause.ghostHide': 'Hide best-run ghost',
  'pause.ghostShow': 'Show best-run ghost',
  'pause.rivalClear': 'RIVAL: CLEAR',
  'pause.rivalLoad': 'LOAD RIVAL',
  'pause.rivalClearLabel': 'Clear rival ghost',
  'pause.rivalLoadLabel': 'Load rival .wsghost',
  'pause.rivalRefused': 'Rival refused: {reason}',
  'pause.rivalStatusRefused': 'Refused',
  'pause.rivalWrongMap': 'Wrong map',
  'pause.rivalInvalid': 'Invalid .wsghost file',
  'pause.rivalLoaded': 'Rival loaded',
  'pause.racing': 'RACING {hour} {map} · hydro {hash} · {quality}',
  'pause.rivalHidden': 'Rival hidden: {reason}',
  'pause.rivalLine': 'Rival {hour} · hydro {hash}',
  'pause.rivalLineQuality': 'Rival {hour} · hydro {hash} · {quality}',
  'pause.rivalUnverified': '{line} (unverified)',
  'pause.unknownHour': 'H??',
  'pause.quit': 'QUIT',
  'pause.quitLabel': 'Quit to Main Menu',
  'pause.confirm': 'RESTART RUN?',
  'pause.confirmSub': 'Progress will be lost.',
  'pause.yes': 'YES',
  'pause.yesLabel': 'Yes, restart',
  'pause.no': 'NO',
  'pause.noLabel': 'No, cancel',
  'pause.keyEnter': 'ENTER',
} as const;
