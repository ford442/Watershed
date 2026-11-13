/**
 * English for the caption layer (CaptionLayer chunk) (#558 C.3). Not in the entry: the
 * layer is fetched only when the player turns captions on, and registers this
 * part (`registerEnglish`) at module load. es / fr hold these keys too.
 */
export const captions = {
  'caption.region': "Captions",
  'caption.left': "from the left",
  'caption.right': "from the right",
  'caption.splash': "Splash",
  'caption.waterCrash': "Crash into the water",
  'caption.raftTip': "Raft capsized",
  'caption.impact': "Impact",
  'caption.hardLanding': "Hard landing",
  'caption.boost': "Boost",
  'caption.hazardHit': "Hit — soaked and chilled",
  'caption.logJam.telegraph': "Log jam breaking",
  'caption.logJam.active': "Logs coming down",
  'caption.iceBridge.telegraph': "Ice bridge cracking",
  'caption.iceBridge.active': "Ice bridge collapsing",
  'caption.damRelease.telegraph': "Dam release in {seconds} s",
  'caption.damRelease.active': "Dam release — surge front",
  'caption.flashFlood.telegraph': "Flash flood in {seconds} s",
  'caption.flashFlood.active': "Flash flood — surge front",
} as const;
