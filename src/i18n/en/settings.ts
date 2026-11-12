/** Options panel, pause menu, menu shell, loader, crash and graphics screens (#566). */
export const settings = {
  // --- Menu shell ---
  'shell.rotate': 'Rotate to landscape for the best view',
  'shell.workshopLoading': 'Loading the River Workshop…',

  // --- Boot loader ---
  'loader.init': 'SYSTEM INITIALIZATION',
  'loader.assets': 'Loading assets… {progress}%',
  'loader.ready': 'READY TO PLAY',
  'loader.readyHint': 'Choose your map and press START RUN',
  'loader.startup': 'STARTING UP',
  'loader.startupHint': 'Initializing graphics engine…',
  'loader.world': 'ENTERING CANYON',
  'loader.worldHint': 'Loading world… {progress}%',
  'loader.stuck': 'STILL LOADING',
  'loader.stuckHint': 'This is taking longer than expected ({progress}%)',
  'loader.progress': 'Asset loading progress',
  'loader.processing': 'PROCESSING: {item}',
  'loader.failed': 'Some assets failed to load. You can still try starting the run.',

  // --- Crash screen ---
  'error.title': '⚠️ Application Error',
  'error.error': 'Error:',
  'error.stack': 'Component Stack:',
  'error.reload': 'Reload Application',

  // --- Safe graphics badge ---
  'graphics.safe.title': 'Safe Graphics Mode',
  'graphics.safe.reduced': '— reduced quality.',
  'graphics.safe.why': 'why?',
  'graphics.safe.hide': 'hide',
  'graphics.safe.dismiss': 'Dismiss',
  'graphics.safe.dismissLabel': 'Dismiss safe graphics notice',
  'graphics.reason.hardware': 'Full graphics.',
  'graphics.reason.caveat':
    'This browser refused a hardware-accelerated WebGL context, so the game is running with antialiasing off, the default GPU adapter, and Low quality for this session (raise it in Options). Enabling hardware acceleration in your browser settings, or updating your graphics driver, usually restores full quality.',
  'graphics.reason.previousBootFailed':
    'The previous start did not get a working WebGL context, so this one began in safe mode at Low quality. Raise it again in Options — one start that draws a frame clears the clamp on its own.',
  'graphics.reason.captureMode': 'Capture harness — graphics envelope pinned, not probed.',
  'graphics.reason.noContext': 'No WebGL2 context is available.',
  'graphics.reason.attributesRejected':
    'This browser grants a WebGL2 context, but not with the depth and stencil buffers the renderer needs.',
  'graphics.bootFailure.noFrame': 'The previous start never drew a frame.',
  'graphics.bootFailure.contextLost': 'The previous start lost its WebGL context.',
  'graphics.bootFailure.deviceLost': 'The previous start lost its WebGPU device.',
  'graphics.bootFailure.rendererThrow': 'The previous start could not create a renderer.',

  // --- No WebGL 2 screen ---
  'graphics.unsupported.title': 'Watershed needs WebGL 2',
  'graphics.unsupported.attributes':
    'This browser grants a WebGL 2 context, but not with the depth and stencil buffers the renderer needs, so the game cannot start.',
  'graphics.unsupported.noContext': 'This browser could not create a WebGL 2 context, so the game cannot start.',
  'graphics.unsupported.accel': 'Turn on hardware acceleration.',
  'graphics.unsupported.accelHow':
    'In Chrome: Settings → System → “Use graphics acceleration when available”, then restart the browser.',
  'graphics.unsupported.driver': 'Update your graphics driver.',
  'graphics.unsupported.driverWhy': 'A blocklisted or crashed driver is refused even when the GPU itself is capable.',
  'graphics.unsupported.reported': 'Browser reported:',
  'graphics.unsupported.noReason': 'The browser gave no reason for the refusal.',
  'graphics.unsupported.check': 'You can confirm the browser’s own view at {chrome} (Chromium) or {firefox} (Firefox).',
} as const;
