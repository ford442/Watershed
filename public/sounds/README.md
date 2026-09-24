# `public/sounds/`

The 23 SFX and ambient beds loaded through `THREE.AudioLoader` by `AudioManager`
(`src/systems/audio/AudioSystem.ts`). The name → file table lives in
`src/systems/audio/soundDefs.ts` (`SOUND_DEFS`).

## Source and license

Every file here is **synthesized by the project** with
[`scripts/generate-sounds.mjs`](../../scripts/generate-sounds.mjs). No
third-party recordings or sample packs are used, so there is nothing to
attribute. The files are covered by the repository's own license. The script
encodes with [`@breezystack/lamejs`](https://www.npmjs.com/package/@breezystack/lamejs)
(LGPL-3.0, a dev-only tool). Its output is not a derivative of the encoder.

They replace the six 1-second sine stubs (2026-05-27) that used to fill all 23
names; see BUILD_HYGIENE.md §6.3.

| File | Recipe |
|---|---|
| `rapids_roar` | Loop, 6 s stereo. Churning pink noise, sub-bass rumble, dense bubble layer (~420/s), spray hiss |
| `ambient_water` | Loop, 6 s stereo. Sparse separate bubbles over a soft wash, plus a trickle |
| `ambient_canyon` | Loop, 8 s stereo. Dark distant roar (brown noise under 420 Hz), slow swell, faint air |
| `ambient_wind` | Loop, 8 s stereo. Resonant **howl** (moving high-Q bandpasses), gusts, hiss. Deliberately unlike the speed-wind rush |
| `water_crash` | 2.8 s. Low slam, pitch-dropping thump, bubble cloud collapsing over ~2 s, falling spray |
| `splash` | 0.9 s. Bandpassed burst, bubble cloud, droplets landing back |
| `collide_rock` | Bright inharmonic stone modes, click, gravel grains |
| `collide_wood` | Hollow plank knock: low, well-separated, longer-ringing modes |
| `collide_moss` | Damped thud, cushion noise, wet squish. Nothing rings |
| `collide_concrete` | Dense, dull, fast-dying modal field, heavy thud, grit |
| `footstep_rock` / `_moss` / `_wood` / `_wet` | Crunch grains, soft rustle, hollow knock, slap + squelch bubbles |
| `jump` / `jump_double` | Push-off scuff + rising body whoosh, then two brighter mid-air swishes |
| `land_soft` / `_hard` / `_impact` | Thump + crunch at increasing mass, cloth, and a splash on the heaviest |
| `paddle_left` / `_right` | Blade-entry plop bubble, water sheeting past the blade, exit drips (different seeds and pitch) |
| `raft_creak` | Stick-slip impulse train through wood resonators |
| `boost` | Rising filtered rush, a soft tonal lift, spray |

Physical models: Minnaert bubbles with van den Doel damping and a rising chirp
(all water), modal synthesis (impacts and footsteps), TPT state-variable filters.

## Regenerating

```bash
node scripts/generate-sounds.mjs                 # all 23
node scripts/generate-sounds.mjs --only splash   # just one
```

The output is **byte-stable** because every recipe uses fixed seeds. Re-running
leaves git clean unless a recipe changed.

## Rules for replacing a file

- **Keep the filename.** `SOUND_DEFS` refers to these files by name, so a
  drop-in `.mp3` (or `.ogg` under the same stem, with the `file` entry updated)
  needs no code change. Beds marked `loop: true` are re-seamed after decode
  (`src/systems/audio/loopBuffer.ts`), so a recorded loop does not need
  sample-exact edges.
- **Every payload must be unique.** `src/systems/audio/soundDefs.test.ts`
  hashes this folder. Two names may share bytes only through an explicit
  `aliasOf` in `SOUND_DEFS`, which also shares the decoded buffer.
- **The speed-wind bed never comes from here.** It is synthesized at runtime:
  the AudioWorklet (`src/systems/audio/speedWindDsp.ts`), or the
  `speedWindBuffer.ts` loop as a fallback. Pointing it at `ambient_wind` would
  bring back the masking #399 removed.
- **Deploy.** These are unhashed passengers. `deploy.py` size-skips only
  `assets/<name>-<hash>.<ext>`, so every file here uploads on every deploy. That
  matters because a replacement can have the same size as the file it replaces
  (`ambient_canyon` and `ambient_wind` are both 128,731 bytes today). Run
  `pnpm verify:deploy` after a deploy to confirm the live bytes match `build/`.
