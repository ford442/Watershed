/**
 * English for the end-of-run results (RunResultsPanel chunk) (#566). Not in the entry: the chunk that renders
 * these keys imports this part and registers it (`registerEnglish`) at module
 * load, before its first render. es / fr hold these keys too (they are lazy anyway).
 */
export const runResults = {
  // --- Run results ---
  'results.dnfAt': 'DNF AT',
  'results.thisRun': 'THIS RUN',
  'results.newPb': 'NEW PB',
  'results.pb': 'PB',
  'results.rival': 'RIVAL',
  'results.rivalRefused': 'RIVAL (REFUSED)',
  'results.riverLine': '{hour} {map} · hydro {hash} · {quality}',
  'results.rivalRefusedNote': 'rival refused — {reason}',
  'results.mismatchLaunch': 'launch {self} vs {label} {other}',
  'results.mismatchHydro': 'hydro {self} vs {label} {other}',
  'results.mismatchQuality': 'quality {self} vs {label} {other}',
  'results.differentRiver': '{label} ran a different river',
  'results.rivalWord': 'rival',
  'results.splitBlame': 'you lost {seconds}s at {event}, not at the shelf',
  'results.seg': 'SEG {index}',
  'results.dnf': 'DNF',
  'results.wipeoutAfter': 'wipeout after checkpoint {index}',
  'results.export': 'EXPORT .WSGHOST',
  'results.copySplits': 'COPY SPLITS',
  'results.copied': 'COPIED!',
  'results.copyLink': 'COPY LINK',
  'results.linkCopied': 'LINK COPIED!',
  'results.copyLinkTitle': 'Link races this ghost at the same hour — host the exported file next to the game',
} as const;
