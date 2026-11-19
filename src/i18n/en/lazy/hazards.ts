/**
 * English for the hazard banner (HazardBanner chunk) (#578 A). Not in the
 * entry: the banner is fetched only while a hazard is up, and registers this
 * part (`registerEnglish`) at module load. es / fr hold these keys too.
 */
export const hazards = {
  'hazard.region': "Hazard warning",
  'hazard.logJam.armed': "Log jam ahead",
  'hazard.logJam.telegraph': "Log jam breaking in {seconds} s",
  'hazard.logJam.active': "Logs coming down",
  'hazard.iceBridge.armed': "Ice bridge ahead",
  'hazard.iceBridge.telegraph': "Ice bridge cracking — {seconds} s",
  'hazard.iceBridge.active': "Ice bridge collapsing",
  'hazard.damRelease.armed': "Dam ahead",
  'hazard.damRelease.telegraph': "Dam release in {seconds} s",
  'hazard.damRelease.active': "Dam release — surge",
  'hazard.flashFlood.armed': "Flash flood risk",
  'hazard.flashFlood.telegraph': "Flash flood in {seconds} s",
  'hazard.flashFlood.active': "Flash flood — surge",
} as const;
