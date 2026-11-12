/**
 * English for the Your Rivers panel (UserRiverPanel chunk) (#566). Not in the entry: the chunk that renders
 * these keys imports this part and registers it (`registerEnglish`) at module
 * load, before its first render. es / fr hold these keys too (they are lazy anyway).
 */
export const userRivers = {
  // --- UserRiverPanel ---
  'menu.rivers': 'Your Rivers',
  'menu.rivers.aria': 'Your rivers',
  'menu.rivers.sharedAria': 'Shared river',
  'menu.rivers.shared': 'Shared with you: {name}',
  'menu.rivers.meta': {
    one: '{count} segment · {hash}',
    other: '{count} segments · {hash}',
  },
  'menu.rivers.play': 'Play',
  'menu.rivers.openWorkshop': 'Open in Workshop',
  'menu.rivers.sharedError': 'The shared river link could not be opened: {error}',
  'menu.rivers.load': 'Load river…',
  'menu.rivers.paste': 'Paste',
  'menu.rivers.pasteAria': 'River JSON',
  'menu.rivers.pastePlaceholder': 'Paste a river link, or JSON exported from the River Workshop',
  'menu.rivers.playPasted': 'Play pasted river',
  'menu.rivers.editAria': 'Edit {name} in the River Workshop',
  'menu.rivers.edit': 'Edit',
  'menu.rivers.hint': 'A .wsriver is a river saved from the River Workshop. Drop one here to run it.',
} as const;
