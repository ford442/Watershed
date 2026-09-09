# DEPLOY — clean tree to a verified deploy

Target: <https://test.1ink.us/watershed/> (static bundle, unzipped over SFTP by
`storage.noahcohn.com`).

The whole point of this document: **never again be unable to say which commit is live.**

---

## Why this is stricter than it looks (#402)

For 26 days the deploy target served an **08-14 Emscripten glue** (`watershed_native.js`,
26999 B) beside an **08-31 wasm binary** (`watershed_native.wasm`, 33817 B). Those two
files are a matched pair; mixed halves die inside embind (`wasmTable.get is not a
function`) or hang. The page hung, RAM climbed, and the console stayed quiet.

Cause: `deploy.py` skipped any file whose **remote byte size** equalled the local size,
and the bundle upload never deletes. Vite's content-hashed asset names can never collide
on size-with-same-name, so that skip could only ever bite the two unhashed passengers
copied from `public/` — which is exactly what it did. Meanwhile nothing compared the
served bytes to the built bytes, so the split was invisible.

Three things now make that impossible to repeat:

| Layer | Guard |
|-------|-------|
| Build | `build-identity.json` + `window.__WATERSHED_BUILD__` — one resolution, two surfaces |
| Boot | `getWasm()` measures both served passengers and banners **"Native WASM provenance mismatch — stale deploy"** |
| Deploy | full upload by default; passengers uploaded as a set; stale/incoherent `build/` refused; `verify_deploy.mjs` compares served bytes to built bytes |

---

## The runbook

### 0. Start clean

```bash
git status --short          # must be empty: a dirty tree is refused by deploy.py
pnpm install                # if node_modules is absent
```

A build made from a dirty tree records `"dirty": true` and matches no commit. `deploy.py`
refuses it, and `verify_deploy.mjs` fails it, unless you pass `--allow-dirty`.

### 1. Build

```bash
pnpm build                  # runs build:wasm, then vite build -> build/
```

`build:wasm` needs emcc **3.1.56** (the pinned version — glue and binary must come from
one compiler). Without emsdk it skips gracefully and the previously committed
`public/watershed_native.*` are used as-is. It regenerates
`src/systems/water/wasmArtifactStamp.ts`, a sha256 over **both** halves of the pair.

Sanity checks worth running once after a wasm rebuild:

```bash
node emscripten/smoke_test.mjs      # expect: watershed_native smoke ok (... abi=8)
cat build/build-identity.json       # commit, dirty, stamp, glueBytes, wasmBytes
```

### 2. Rehearse — no token needed

```bash
python3 deploy.py --dry-run
```

Passes when it prints `✓ build/ is coherent`, the identity line, a file manifest
(`P` = unhashed passenger, always uploaded), and
`Dry run: stopping before the network upload.` Exit 0.

Fails loudly (exit 1, `✗ REFUSING TO DEPLOY: …`) when `build/` is missing, has no
`build-identity.json`, records passenger sizes that disagree with the files on disk, was
built from a different commit than HEAD, or was built dirty.

### 3. Deploy

```bash
export DEPLOY_TOKEN="<token from the VPS env>"    # never commit or echo this
python3 deploy.py
```

Full upload is the default. `--incremental` skips content-hashed assets that already
match by size on the server — the passengers (`index.html`, `build-identity.json`,
`watershed_native.js`, `watershed_native.wasm`, `watershed_native.worker.js`) are always
uploaded, together, regardless of mode.

### 4. Verify — this is the step that closes #402

```bash
node verification/verify_deploy.mjs --expect $(git rev-parse HEAD)
# or: pnpm verify:deploy
```

**Pass** (exit 0) looks like:

```
Verifying https://test.1ink.us/watershed/
  identity: commit=d82af21 stamp=48807a27dda538ad glue=33562B wasm=33811B builtAt=…
  asset ok  200 https://test.1ink.us/watershed/assets/index-….js
  …
  watershed_native.js: served 33562B, identity says 33562B
  watershed_native.wasm: served 33811B, identity says 33811B
VERDICT: LIVE — commit=d82af21 stamp=… glue=33562B wasm=33811B builtAt=… (5 assets 200)
```

**Fail** (exit 1) names the reason on the verdict line, e.g.:

```
  ✗ watershed_native.wasm served 33840B but the identity records 33811B — SPLIT PROVENANCE
VERDICT: NOT LIVE — 1 problem(s): …
```

```
  ✗ build-identity.json is missing or unparsable — the server is running a build that
    predates build identity (i.e. NOT this code).
VERDICT: NOT LIVE — 1 problem(s): …
```

The second is what the live URL says **today**, before Noah's next deploy.

### One command for all of it

```bash
python3 build_and_patch.py            # build -> deploy -> verify (--expect HEAD)
python3 build_and_patch.py --dry-run  # rehearsal; the verify failure afterwards is expected
python3 build_and_patch.py --skip-verify   # discouraged: you will not know what is live
```

---

## Reading the live site without any tooling

```js
// browser console on https://test.1ink.us/watershed/
__WATERSHED_BUILD__
// { commit, commitShort, dirty, builtAt, wasmStamp, glueBytes, wasmBytes, … }
```

```bash
curl -s https://test.1ink.us/watershed/build-identity.json
```

Both come from the same build-time resolution (`scripts/buildIdentity.mjs`), so they
cannot disagree.

Boot logs, in order, on a healthy load:

```
[Watershed WASM] init started url=…/watershed_native.js?v=<stamp> stamp=<stamp>
[Watershed WASM] wasm bytes=33811/33811 glue bytes=33562/33562 build=commit=… stamp=…
[Watershed WASM] abi=8 (min=6, ok)
[Watershed WASM] ready (abi=8)
```

Terminal lines you may see instead — each maps to a distinct HUD banner:

| Log | Banner | Meaning |
|-----|--------|---------|
| `timed-out(8000ms)` | Native WASM init timed out | factory never settled; TS fallback |
| `provenance-mismatch(…)` | Native WASM provenance mismatch — stale deploy | served glue/wasm are from different builds |
| `failed(<message>)` | Native WASM failed to init | anything else |

Deadline override for debugging: `?wasmInitTimeout=2000`.

---

## Proving the guards still bite

Guards that have never failed are not guards. Both are reproducible:

```bash
# Boot guard: serve build/, then swap in a wasm from another build
pnpm preview --host 127.0.0.1 --port 4173 &
node verification/provenance_guard_proof.mjs http://127.0.0.1:4173      # control: ready (abi=8)
git show <older-commit>:public/watershed_native.wasm > build/watershed_native.wasm
node verification/provenance_guard_proof.mjs http://127.0.0.1:4173      # provenance-mismatch + banner
pnpm build                                                              # restore

# Verifier: fabricate an identity that contradicts the files
python3 - <<'PY'
import json; p='build/build-identity.json'; d=json.load(open(p)); d['wasmBytes'] += 29; json.dump(d, open(p,'w'), indent=2)
PY
node verification/verify_deploy.mjs http://127.0.0.1:4173   # exit 1, SPLIT PROVENANCE
pnpm build                                                 # restore
```

---

## Test surfaces

```bash
pnpm test                 # includes buildIdentity, the provenance assert, verify_deploy parsing
pnpm test:deploy          # deploy.py plan/preflight unit tests (python3 unittest)
pnpm verify:deploy        # live check
```

---

## Security

`DEPLOY_TOKEN` is read from the environment only. It must never appear in output, logs,
commits or docs. A token was hard-coded in `deploy.py` historically and is in git
history — treat it as compromised; rotating it on the VPS and scrubbing history are
manual owner actions.
