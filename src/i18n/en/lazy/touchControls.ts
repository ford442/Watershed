/**
 * English for the touch layer (TouchControls chunk) (#566). Not in the entry: the chunk that renders
 * these keys imports this part and registers it (`registerEnglish`) at module
 * load, before its first render. es / fr hold these keys too (they are lazy anyway).
 */
export const touchControls = {
  // --- Touch layer ---
  'touch.pause': 'Pause',
  'touch.paddleLeft': 'Paddle left',
  'touch.paddleRight': 'Paddle right',
  'touch.paddleLeftShort': 'L',
  'touch.paddleRightShort': 'R',
  'touch.jump': 'Jump',
  'touch.jumpButton': 'JUMP',
} as const;
