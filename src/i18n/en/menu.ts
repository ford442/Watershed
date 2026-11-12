/** Start menu strings (#566 A): title, map / mode / vehicle pick, pre-run pickers, river cards. */
export const menu = {
  // --- Map display names (mapLabel) ---
  'map.glacial': 'Glacial Source',
  'map.lumber': 'Lumber Flume',
  'map.meander': 'Meander to Waterfall',
  'map.hydro': 'Hydro-Dam',
  'map.delta': 'River Delta',

  // --- Journey / in-run shell (ExperienceUI) ---
  'journey.continueTo': 'Continue to {map}',
  'experience.loadingLevel': 'Loading custom level...',
  'experience.loadingReach': 'Loading Reach...',
  'experience.reachUnavailable': '⚠ Reach unavailable — playing procedural track',
  'experience.retry': 'Retry',
  'experience.dismiss': 'Dismiss',

  // --- Difficulty ---
  'difficulty.beginner': 'Beginner',
  'difficulty.intermediate': 'Intermediate',
  'difficulty.advanced': 'Advanced',
  'difficulty.expert': 'Expert',

  // --- Flow forecast states (FLOW_FORECAST_STATES values) ---
  'flow.Normal': 'Normal',
  'flow.HighFlow': 'High flow',
  'flow.Flooded': 'Flooded',
  'flow.WashedOut': 'Washed out',

  // --- Weather types ---
  'weather.clear': 'Clear',
  'weather.rain': 'Rain',
  'weather.storm': 'Storm',
  'weather.snow': 'Snow',
  'weather.fog': 'Fog',
  'loadout.trail-light.label': 'Trail Light',
  'loadout.trail-light.short': 'LIGHT',
  'loadout.trail-light.description': 'Minimal kit — fast drying, weak cold protection.',

  // --- Loadouts ---
  'loadout.balanced.label': 'Balanced',
  'loadout.balanced.short': 'BALANCED',
  'loadout.balanced.description': 'Standard runner kit for mixed canyon biomes.',
  'loadout.expedition.label': 'Expedition',
  'loadout.expedition.short': 'EXPED',
  'loadout.expedition.description': 'Insulated layers — slower but resists glacial cold.',
  /** The game's name: the same in every locale. */

  // --- StartMenu ---
  'menu.title': 'WATERSHED',
  'menu.tagline': 'From alpine source to valley delta — shed the water.',
  'menu.preparing': 'Preparing game assets…',
  'menu.ready': 'Ready — press START RUN or Enter',
  'menu.playMode': 'Play Mode',
  'menu.playMode.aria': 'Play mode',
  'menu.mode.single': 'Single Map',
  'menu.mode.journey': 'Journey',
  'menu.mode.journeyHint':
    'Seamless descent across the unlock graph — survival and score carry at each reach boundary.',
  'menu.mode.singleHint': 'Play one authored map. Continue still hands off without remounting the world.',
  'menu.journeyRoute.aria': 'Journey route',
  'menu.descentRoute': 'Descent Route',
  'menu.selectMap.aria': 'Select map',
  'menu.chooseMap': 'Choose Map',
  'menu.mapMeta': '{difficulty} · {duration}',
  'menu.badge.last': 'Last',
  'menu.badge.locked': 'Locked',
  'menu.best': 'Best {score}',
  'menu.softLockHint': 'Soft-lock marks campaign order — every map stays playable.',
  'menu.vehicle': 'Vehicle',
  'menu.vehicle.auto': 'River decides',
  'menu.vehicle.runner': 'Runner',
  'menu.vehicle.raft': 'Raft',
  'menu.vehicle.onlyRaft': '{map} is a raft river.',
  'menu.vehicle.onlyRunner': '{map} is a runner river.',
  'menu.start.aria': 'Start Game - Click or Press Enter',
  'menu.start.preparingAria': 'Preparing game assets',
  'menu.start.run': 'START RUN',
  'menu.start.journey': 'START JOURNEY',
  'menu.start.preparing': 'PREPARING…',
  'menu.start.keyHint': 'ENTER',
  'menu.workshop': 'RIVER WORKSHOP',
  'menu.workshop.aria': 'Open the River Workshop',
  'menu.options': 'OPTIONS',
  'menu.options.aria': 'Open Options',
  'menu.hint.moveKeys': 'WASD / ↑←↓→',
  'menu.hint.move': 'Move',
  'menu.hint.mouse': 'Mouse',
  'menu.hint.look': 'Look',
  'menu.hint.space': 'Space',
  'menu.hint.jump': 'Jump',
  'menu.hint.esc': 'Esc',
  'menu.hint.pause': 'Pause',
  'menu.hint.padKeys': 'D-pad · A · Start',
  'menu.hint.padActions': 'Navigate · Select · Start run',
  'menu.hint.readout': 'Movement readout',

  // --- LaunchHourPicker ---
  'menu.launchHour': 'Launch Hour',
  'menu.launchHour.value': '{hour} · {state} ({rate}x)',
  'menu.launchHour.aria': 'Select launch hour',
  'menu.launchHour.tick': 'H{hour}: {state}',
  'menu.launchHour.hint': 'Launch hour locks flow, width, and hazard level for the entire run.',

  // --- LaunchWeatherPicker ---
  'menu.weather': 'Weather',
  'menu.weather.aria': 'Select launch weather',
  'menu.weather.hint.clear': 'The river as forecast.',
  'menu.weather.hint.rain': 'Runoff raises the river from the source down.',
  'menu.weather.hint.storm': 'Heavy runoff, worst in the afternoon. Lightning.',
  'menu.weather.hint.snow': 'No extra water — the melt turns to slush and drags.',
  'menu.weather.hint.fog': 'Low visibility; the river is unchanged.',
  'menu.weather.runoff': '+{rate}x flow at the source.',

  // --- LoadoutPicker ---
  'menu.loadout': 'Gear Loadout',
  'menu.loadout.hint': 'Mass vs insulation — affects cold exposure and sprint recovery.',

  // --- CachePlacementPanel ---
  'menu.caches': 'Scout Caches',
  'menu.caches.hint': {
    one: 'Place up to {count} cache on high ground before launch.',
    other: 'Place up to {count} caches on high ground before launch.',
  },
  'menu.caches.slotMeta': 'Seg {segment} · +{bonus} on retrieve',
} as const;
