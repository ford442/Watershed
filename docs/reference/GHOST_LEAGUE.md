# Ghost League — splits, results, rival (#375 Phase A–C)

Offline-only, no accounts, no server. Builds on the Phase A+B ghost system from
#357 (`src/systems/ghost/`): local PB ghost, `.wsghost` export/import, HUD
time-delta.

## Clock

Splits and the finish time are both read off the **ghost recorder's own
sample clock** (`GhostRecorder.getGhostElapsedMs()` — `sampleCount / 10 Hz`),
not a separate wall-clock timer. Recording freezes on wipeout/pause (see
`useExperienceLifecycle`'s `tickGhostRecording` gate), so a split or finish
time read any time after a run ends is stable without extra bookkeeping.
Precision is one sample interval (100 ms).

## Checkpoint splits (`RunSplitEntry`, in `ghostCodec.ts`)

```ts
interface RunSplitEntry {
  segmentIndex: number;
  tMs: number;   // elapsed run time at the checkpoint
  speed: number; // vehicle speed at the checkpoint (m/s)
}
```

`SplitRecorder.ts` listens for the `segment-enter` window event and records
one split per segment — first entry wins; re-entering a segment (e.g. after a
checkpoint respawn) never overwrites it. Splits reset on `watershed-run-reset`.

## `.wsghost` file version

`GHOST_CODEC_VERSION` (in `ghostCodec.ts`) doubles as the `.wsghost` file
format version:

| Version | Adds |
|---------|------|
| 1 | Pose payload only (7-float delta-encoded samples, base64). |
| 2 | Optional `splits: RunSplitEntry[]`. The pose encoding is unchanged, so a v1 file is a valid v2 file with no splits. |
| 3 | Optional `launchHour`, `hydroEventHash`, `qualityPreset` (#391). |

`importGhostFromJson` accepts `codecVersion <= GHOST_CODEC_VERSION` — only a
file *newer* than this build understands is rejected. A malformed `splits`
entry (wrong shape, negative `tMs`) fails import with `invalid_format`.

## PB commit — why it's synchronous, not an effect

`runFinish.ts`'s `commitTimedFinish(runKey)` runs **inline** at the two
`setJourneyComplete()` call sites (`TrackManager`'s `onSegmentEnter` and
`useExperienceWorld.performSeamlessMapHandoff`), not from a `useEffect`
reacting to `isJourneyComplete`. `PersistenceSystem`'s cache is a plain module
object, not Zustand state — a component that renders on
`isJourneyComplete === true` and calls `getRunBest()` would otherwise race an
effect-based commit and could paint stale (pre-commit) data on its first
frame. Calling it synchronously before the Zustand flip removes the race:
by definition nothing can render before that plain function call returns.

`commitTimedFinish` is idempotent per run (guarded, reset on
`watershed-run-reset`) and returns a `RunFinishSummary` snapshot — this run's
time/splits **and** the PB as it stood immediately before this run
(`previousBestTimeMs` / `previousSplits`). The results screen
(`RunResultsPanel.tsx`) diffs against that snapshot rather than re-reading
`getRunBest()` after the commit already overwrote it — otherwise "this run
vs PB" would trivially show zero delta on every new-PB run.

A DNF (wipeout) never calls `commitTimedFinish` — no time PB is set — but
`SplitRecorder.getRecordedSplits()` still holds whatever was recorded before
the wipeout froze it, which is what the results screen's DNF row reads.

## Rival ghost (Phase C)

One imported rival ghost per map, stored in `PersistencePayload.rivals`
(`PersistenceSystem.getRivalGhost` / `setRivalGhost` / `clearRivalGhost`).
Loaded via PauseMenu's **LOAD RIVAL** button (any `.wsghost`, validated
against the active map) or a same-origin `?ghost=<url>` query param
(`rivalGhostUrl.ts`).

`?ghost=` is opt-in sharing, never a boot dependency:

- Relative or same-origin URLs only (cross-origin is ignored).
- HTTP 404, network failure, or invalid JSON is **silent** — the game starts without a rival.
- There is no accounts backend and no anti-cheat.

`GhostReplayer.tsx` renders the PB ghost (cyan, `#7ec8ff`) plus the rival
ghost (amber, `#f5a623`) when one is loaded — capped at these two bodies.

## Fairness metadata (codec v3 / #391 Phase B)

`.wsghost` v3 adds optional `launchHour`, `hydroEventHash`, and `qualityPreset`.
v1/v2 files still import. When this run and the rival/PB differ, the results
panel names the hour/hash and can blame a lost split on the hydro event that
owns that segment ("you lost 1.4s at the dam pulse, not at the shelf").

| Version | Adds |
|---------|------|
| 1 | Pose payload only (7-float delta-encoded samples, base64). |
| 2 | Optional `splits: RunSplitEntry[]`. |
| 3 | Optional `launchHour`, `hydroEventHash`, `qualityPreset`. |

## Results screen

`RunResultsPanel.tsx`, mounted inside `GameHUD`'s wipeout and
journey-complete overlays. Split rows are colored against the *previous* PB
split at the same segment: gold = new best, green = tied, red = behind, gray
= no reference (first time reaching that checkpoint). Buttons export the
current run as `.wsghost` and copy the split table as plain text.
