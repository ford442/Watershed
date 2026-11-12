/**
 * English for the Today's River card (TodaysRiverCard chunk) (#566). Not in the entry: the chunk that renders
 * these keys imports this part and registers it (`registerEnglish`) at module
 * load, before its first render. es / fr hold these keys too (they are lazy anyway).
 */
export const todaysRiver = {
  // --- TodaysRiverCard ---
  'menu.daily': "Today's River",
  'menu.daily.date': '{date} UTC',
  'menu.daily.title': '{map} · {hour} · {state} ({rate}x)',
  'menu.daily.weatherAria': 'Weather script',
  'menu.daily.pattern.clear': 'Clear all day',
  'menu.daily.pattern.squall': 'A squall crosses mid-reach, then clears',
  'menu.daily.pattern.showers': 'Showers clearing',
  'menu.daily.pattern.building': 'Weather building to a storm',
  'menu.daily.pattern.fog': 'Morning fog lifting',
  'menu.daily.pattern.flurries': 'Snow flurries passing',
  'menu.daily.conditions': '{pattern} · {temperature} °C · snowpack {snowpack}',
  'menu.daily.best': "today's best {time}",
  'menu.daily.run': "RUN TODAY'S RIVER",
} as const;
