# User levels (workshop-scale)

Drop a JSON level here and fetch it same-origin, or persist via the in-game
editor (`?editor=1` export → `localStorage` key `watershed.userLevels`).

Files must validate under the repo `level.schema.json` (`assertLevelData`).
Include `hydroEvents[]` if the level should pulse/vortex/braid with launch hour.

This is not Steam Workshop. There is no accounts backend.

Example fetch (silent 404 is fine): `public/levels/gentle-creek.json`
