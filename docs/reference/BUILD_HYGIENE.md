# Build Hygiene: Determinism and the Unhashed-Passenger Contract (2026-09-17)

Read-only investigation of `pnpm build` reproducibility, plus a manifest contract and a
standalone guard for the files Vite does **not** content-hash.

Scope lock honoured: `deploy.py`, `build_and_patch.py`, `vite.config.ts`, `index.html`,
`src/systems/water/`, `src/physics/`, and `verification/` were **read but not modified**.
`package.json` was not modified — see [§8](#8-recommended-package-json-entry) for the exact line to add.
Nothing in this document was fixed; everything is reported or guarded. Two deliverables were added:
this file and [`scripts/check-build-manifest.mjs`](../../scripts/check-build-manifest.mjs).

Commands run: `pnpm install --frozen-lockfile`, `pnpm build` ×2, `pnpm audit`.

---

## 0. Summary

| Question | Answer |
|---|---|
| Is `pnpm build` deterministic? | **Yes, modulo one deliberate entropy source.** Every byte is reproducible except what derives from `BUILD_IDENTITY`, which embeds a wall-clock timestamp and a random nonce. |
| Do the `public/` passengers arrive byte-identical? | **Yes — 37/37**, verified by sha256. |
| Is the `watershed_native.js` / `.wasm` pair coherent? | **Yes.** `sha256(js ‖ wasm)[0:16]` = `4d5ade0f0dc990a0`, matching the stamp `emscripten/build.sh` recorded. Same emcc invocation. |
| Are the dead `shaders/*.wgsl` gone locally? | **Yes.** Neither `public/shaders/` nor `build/shaders/` exists; the source-side `shaders/` directory is gone too. |
| Do the chunk budgets still hold? | `vendor-rapier` 2.237 MB and entry 1.815 MB — **yes, essentially unchanged**. But they should not hold: see [§4](#4-chunk-sizes-against-budget). |
| `pnpm audit` | 47 advisories. **One group ships to browsers** (`fast-uri` via `ajv`). Exactly one group is blocked by the r168 pin. |

Four findings not previously recorded are in [§6](#6-new-findings). The most consequential:
**Rapier's WASM ships three times, and one of the three copies is dead and divergent.**

---

## 1. Environment and build outcome

`pnpm install --frozen-lockfile` succeeded in 3.2 s against the committed `pnpm-lock.yaml`.
pnpm declined to run two postinstall scripts (`esbuild@0.27.7`, `puppeteer@24.40.0`); neither
blocked the build.

`pnpm build` is `npm run build:wasm && vite build`. As in the deploy audit, **`build:wasm` skipped
gracefully**: `emcc`/`emcmake` are not on `PATH`, `emscripten/build.sh` detects this, prints
`[build:wasm] Emscripten not found — skipping WASM compile`, and exits 0. The committed
`public/watershed_native.{js,wasm}` were reused rather than regenerated.

This is worth stating plainly, because it is also what makes the WASM half of the build trivially
reproducible here: **this run did not exercise emcc determinism at all.** A machine with emsdk
loaded would recompile both files, and whether *that* is byte-reproducible is a separate,
unanswered question. `WATERSHED_REQUIRE_WASM=1` converts the skip into a hard failure.

`vite build` succeeded both times: 1102 modules, ~12 s, no errors. The two pre-existing warnings
(dynamic-vs-static import of `three.webgpu.js`; >500 kB chunks) reproduced identically and are
unrelated to determinism.

---

## 2. Determinism: two builds compared

Both builds ran from the same clean tree at `736c0e0`, into separate preserved copies of `build/`.
Of 52 emitted files, **42 are byte-identical** and **10 differ**.

### Byte-identical across runs (42 files)

All 37 `public/` passengers, plus:

| File | Size |
|---|---|
| `assets/vendor-three-Dj7yHq31.js` | 1,068,786 |
| `assets/vendor-rapier-DW2HfIcf.js` | 2,237,128 |
| `assets/vendor-post-DD9N1iSc.js` | 700 |
| `assets/rapier.worker-B1wd4Aqq.js` | 2,244,843 |
| `assets/index-BOXWngyV.css` | 30,457 |

Identical filenames *and* identical bytes. Rollup's chunk ordering, module ID assignment, minified
identifier allocation, and CSS emission are all stable here. **There is no non-deterministic
chunk ordering and no embedded timestamp in the vendor output.**

### Differed across runs (10 files) — single root cause

```
BUILD_ID                                     (content)
index.html                                   (content)
assets/index-CH0CHYjD.js  → index-DXu6qYDC.js            (renamed + content)
assets/CanyonNodeMaterial-BMTxB5VC.js   → -DvmGzP4M.js   (renamed + content)
assets/CritterNodeMaterials-CvN7WUEl.js → -Bzrm4KKX.js   (renamed + content)
assets/FoliageNodeMaterials-Z10qtgTk.js → -D6yrfQ3J.js   (renamed + content)
assets/RiverNodeMaterial-CMVGaE04.js    → -OPY2XtjG.js   (renamed + content)
assets/SkyNodeMaterial-DC9y0dDd.js      → -DVjiz_6W.js   (renamed + content)
assets/WaterNodeMaterial-BuxFS2z1.js    → -CCZXFSz4.js   (renamed + content)
assets/WeatherNodeMaterial-CRu2nbL7.js  → -BmnTvL5P.js   (renamed + content)
```

The cause is **not** a guess. `vite.config.ts` builds a single string:

```ts
const BUILD_IDENTITY = `${shortGitSha()} ${readWasmArtifactStamp()} ${new Date().toISOString()} n${randomBytes(1)[0]}`;
```

Observed values:

```
run A:  736c0e0 4d5ade0f0dc990a0 2026-09-17T05:00:27.951Z n8
run B:  736c0e0 4d5ade0f0dc990a0 2026-09-17T05:00:55.390Z n133
```

The git SHA and WASM stamp are stable. `new Date().toISOString()` and `randomBytes(1)[0]` are the
entropy. Both are deliberate — the comment in `vite.config.ts` explains that the nonce exists
specifically so `index.html`'s byte length moves, defeating a size-based skip in `deploy.py`.

That entropy propagates through four mechanisms:

1. **`define: __WATERSHED_BUILD_IDENTITY__`** inlines the string into whichever chunk references
   it — the entry. Confirmed in the output: `const SZ="736c0e0 4d5ade0f0dc990a0 2026-09-17T05:00:27.951Z n8"`.
   Different bytes ⇒ different Rollup hash. **This is the whole cause.**
2. **Hash cascade.** The 7 lazy `*NodeMaterial*` chunks each statically
   `import … from"./index-<hash>.js"`. When the entry's hash changes, their *own* bytes change
   (the import specifier is part of the file), so their hashes change too. Verified: after
   normalizing `-XXXXXXXX.js` specifiers, every one of the 7 is **byte-identical** between runs.
   They contain no build identity of their own; they are pure collateral.
3. **`transformIndexHtml`** writes the identity into `<meta name="build-id">`, and `index.html`
   also carries the entry's new hash.
4. **`writeBundle`** writes `build/BUILD_ID`.

Verification that nothing else is at play: normalizing both the identity string and all
8-char hashes makes the entry chunk **byte-identical** between runs:

```
$ sed -E -e 's/2026-09-17T05:00:[0-9.]+Z n[0-9]+/STAMP/g' -e 's/-[A-Za-z0-9_-]{8}\.js/-HASH.js/g' …
ENTRY IDENTICAL after normalization
```

### What this costs, and the recommendation

`pnpm build` is reproducible. The build *identity*, by design, is not. Two consequences:

- **A content hash no longer signals a content change.** 8 of the 12 JS chunks re-hash on every
  build, including the 1.81 MB entry. The self-verifying property that makes `assets/` safe to
  deploy blind is preserved for the four vendor chunks and defeated for the rest. You cannot look
  at two builds' hashes and conclude whether any code changed.
- **Cache churn.** Every deploy forces every client to re-download the 1.81 MB entry (528 kB
  gzipped) plus 7 lazy chunks, even for a no-op rebuild.

**Recommendation (not applied — `vite.config.ts` is scope-locked):** derive the value passed to
`define` from *content only* — `shortGitSha()` + the WASM stamp — and keep the timestamp and nonce
in the `transformIndexHtml` meta tag and `BUILD_ID`, which are what `deploy.py`'s size-skip
actually reads. `index.html` and `BUILD_ID` would stay unique per build; the entry chunk and its 7
dependents would become content-addressed again. This is a change to a file another agent owns
this week, so it is filed here rather than made.

---

## 3. The manifest contract

52 files: **13 hashed** (all under `assets/`), **39 unhashed**, 15,253,502 bytes total.

Regenerate at any time:

```bash
node scripts/check-build-manifest.mjs --manifest
node scripts/check-build-manifest.mjs --json build-manifest.json
```

### Correction to `DEPLOY_AUDIT.md` §1

The audit lists **36** unhashed passengers. The correct figure is **37**, and two entries are wrong:

| Audit says | Actually |
|---|---|
| "6 `Rock031_*` textures" | **7 files.** `Rock031.png` (386,708 B) was omitted — it does not match the `Rock031_1K-JPG_*` naming and was missed. |
| "`shaders/heightmap_flow.wgsl`" | **Does not exist.** `public/shaders/` is gone (see [§5](#5-dead-file-verification)). |
| `index.html` "718 bytes" | **812 bytes.** The `<meta name="build-id">` line was added after the audit. |

Net: 36 − 1 (wgsl) + 1 (png) = **37**. Both errors were in the audit's *favour* (it under-counted
the real exposure by one live file while counting one dead one), which is why the count matched.

### The 39 unhashed files

| Group | Count | Bytes | Notes |
|---|---|---|---|
| `index.html` | 1 | 812 | generated; references 5 hashed files by exact name |
| `BUILD_ID` | 1 | 55 | generated by `writeBundle` |
| `Rock031*` textures | 7 | 6,181,147 | **largest group on disk** |
| `sounds/*.mp3` | 23 | 395,140 | see [§6.3](#63-the-23-mp3s-are-6-placeholder-stubs) |
| `rapier.wasm` | 1 | 1,569,588 | **dead — see [§6.1](#61-rapiers-wasm-ships-three-times)** |
| `levels/*` | 4 | 10,824 | 3 JSON + `README.md` |
| `watershed_native.{js,wasm}` | 2 | 60,869 | emcc pair |
| `collision.wav` | 1 | 324 | |

### The contract, as asserted by the guard

`scripts/check-build-manifest.mjs` asserts eight properties. Each one was tested by deliberately
breaking it against a throwaway copy of `build/`; all eight produce a non-zero exit and a
specific message.

| # | Assertion | Catches |
|---|---|---|
| 1 | Every `public/` file (except `index.html`) arrives in `build/` with an identical sha256 | A passenger whose bytes changed under a name that did not — **the exact class of bug that let the deploy serve an incoherent build for a month** |
| 2 | `build/index.html` is the *generated* document (has a `./assets/` module script, no `__WATERSHED_BUILD_ID__` placeholder) and is **not** byte-identical to `public/index.html` | See [§6.2](#62-publicindexhtml-is-a-blank-page-waiting-to-happen) |
| 3 | Every `assets/…` path `index.html` references exists in the build | A dangling entry reference — a white screen |
| 4 | `build/BUILD_ID` equals `index.html`'s `build-id` meta | Two halves of the output from different builds |
| 5 | `sha256(watershed_native.js ‖ .wasm)[0:16]` equals `WASM_ARTIFACT_STAMP`, matches `BUILD_ID`'s stamp field, and the glue references `"watershed_native.wasm"` | A `.js`/`.wasm` pair from **different emcc invocations**, or a JS bundle compiled against a different WASM than the one shipped beside it |
| 6 | No `build/shaders/` or `public/shaders/` | A resurrected dead asset lane; a stale output tree |
| 7 | Every unhashed file in `build/` is declared in the script | A **new** unguarded passenger added without anyone noticing |
| 8 | Every file under `assets/` carries an 8-char hash | A chunk silently losing its content hash |

Assertion 5 is the strongest guarantee available, and it is nearly free: `emscripten/build.sh:120`
already computes `sha256(js ‖ wasm)[0:16]` and writes it to
`src/systems/water/wasmArtifactStamp.ts`. That stamp *is* a pairing proof — recomputing it from
the shipped files proves the two came from one emcc run. Current value `4d5ade0f0dc990a0`, verified
identical across `public/`, `build/`, `BUILD_ID`, and the declared stamp.

The passenger inventory is **pinned in the script, not derived from `public/`**. Deriving it would
make assertion 7 vacuous: any file someone dropped into `public/` would be self-justifying. Adding
a passenger should be a line in a commit.

---

## 4. Chunk sizes against budget

Budgets: 60 FPS, <300 MB memory post-load.

| Chunk | Raw | gzip | vs. last measurement |
|---|---|---|---|
| `assets/rapier.worker-*.js` | 2,244,843 | 837,605 | — |
| `assets/vendor-rapier-*.js` | 2,237,128 | 834,218 | 2.2 MB → **holds** |
| `assets/index-*.js` (entry) | 1,814,777 | 527,420 | 1.77 MB → **holds** (+2.5%) |
| `assets/vendor-three-*.js` | 1,068,786 | 298,074 | — |
| `assets/index-*.css` | 30,457 | 5,839 | — |
| 7 lazy `*NodeMaterial*.js` | 24,760 | 10,843 | — |
| `assets/vendor-post-*.js` | **700** | 425 | — |
| **Total `assets/`** | **7,421,451** | ~2.51 MB | |
| **Total `build/`** | **15,253,502** | | |

Both prior figures still hold. Neither *should*.

**`vendor-rapier` at 2.237 MB is not a Rapier-sized number.** It is
`@dimforge/rapier3d-compat` with its 1.57 MB `.wasm` base64-inlined into JavaScript — a single
2,092,530-character string literal. Base64 costs 33% over the wire *and* forces the whole module
through the JS parser before `WebAssembly.compile` ever sees it. It is then shipped **twice** (see
[§6.1](#61-rapiers-wasm-ships-three-times)).

**`vendor-post` at 700 bytes is a manualChunks split that is not doing its job.** It contains
only three Three.js base classes (`Pass`, `FullScreenQuad`, and a fullscreen triangle geometry).
The actual `postprocessing@6` package landed in the **entry chunk**, not here. `CLAUDE.md` already
notes that nothing imports `@react-three/postprocessing`; what it does not note is that naming
`postprocessing` in `manualChunks` failed to extract it, so the effect library is inflating the
1.81 MB entry instead of splitting out.

**`ajv` + `ajv-formats` ship to every player inside the entry chunk.** Confirmed by the `schemaEnv`
and `must be equal to one of the allowed values` markers in `index-*.js`. `ajv` is a runtime
JSON-Schema *compiler* (676 kB of `dist/` in `node_modules`), pulled in by `levelValidator.ts`,
`reachValidator.ts`, and `PersistenceSystem.ts`. It is the only reason `fast-uri` — the one
browser-reachable security advisory in [§7](#7-pnpm-audit) — is in the bundle at all. Validating
authored maps at runtime in a shipped game build is a design question worth asking; for map JSON
the project authors itself, schema validation belongs in `typecheck`/CI.

### Against the 300 MB budget

Nothing here is measured FPS or heap, and this task did not run the game. What the manifest
does establish is the *floor*: if a session loads both Rapier copies, decoded Rapier WASM alone is
~3.1 MB of `ArrayBuffer` plus two compiled `WebAssembly.Module`s, on top of ~4.19 MB of base64
string that must be parsed and then (hopefully) collected. That is a real, avoidable fraction of
the budget before a single canyon chunk exists. **Flagged, not measured.**

Nothing has grown unreasonably since the last measurement. The sizes were already unreasonable.

---

## 5. Dead-file verification

The audit found 4 `shaders/*.wgsl` on the server that the codebase no longer generates, plus
`heightmap_flow.wgsl` which it then listed among the live passengers. Locally, as of `736c0e0`:

```
$ ls public/shaders
ls: cannot access 'public/shaders': No such file or directory
$ ls build/shaders
ls: cannot access 'build/shaders': No such file or directory
```

The source-side shaders directory is gone as well (`ls` on it fails identically; it is not spelled
out here because `scripts/validate-markdown-paths.js` resolves any `src/…` token in living markdown
and would flag the citation as a broken path — which is precisely the point being made).

**`public/shaders/` and `build/shaders/` contain only what is expected: nothing.** The whole lane
is retired, including `heightmap_flow.wgsl` itself — so the server's dead-file count is **5**, not 4.

Checked for a dangling runtime fetch, since a retired asset that something still requests is worse
than a dead one: **there is none.** The `HeightmapFlow.ts` module that used to fetch it no longer
exists, and nothing under the source tree fetches a `.wgsl`. The only WGSL left is inline template literals in
`src/rendering/gpuChores/kernels.wgsl.ts` (compiled into the bundle, correct) and prose comments.
Guard assertion 6 keeps it that way.

Two documentation drifts, noted not fixed: `CLAUDE.md`'s directory map still lists
a source-side `shaders/HeightmapFlow.ts`, and `weekly_plan.md:213` still describes
`public/shaders/heightmap_flow.wgsl` as existing and fetched.

---

## 6. New findings

### 6.1 Rapier's WASM ships three times

| Copy | Size | sha256 (16) | Reachable? |
|---|---|---|---|
| inlined in `assets/vendor-rapier-*.js` | 2,092,530 B base64 → 1,569,397 B wasm | `18157113bd106b5c` | yes |
| inlined in `assets/rapier.worker-*.js` | 2,092,530 B base64 → same | `18157113bd106b5c` | yes |
| `build/rapier.wasm` (passenger) | 1,569,588 B | `1ce1c8c4036b4dcd` | **no** |

Two distinct problems.

**The two inlined copies are byte-identical** — same 2,092,530-char base64 blob, same sha256 —
because `src/physics/rapier.worker.ts` imports `@dimforge/rapier3d-compat`, and a Rollup worker
bundle cannot share a chunk with the main graph. So the engine is emitted once for the main thread
and once for the worker: **4.19 MB of base64 (1.67 MB gzipped) for one physics engine.**

**`build/rapier.wasm` is dead, and it is a *different build* of Rapier.** 1,569,588 bytes versus
the 1,569,397 actually executed — 191 bytes apart, valid WASM (`\0asm`), different sha256. Nothing
in the repo references it:

```
$ grep -rn 'rapier\.wasm' . | grep -v node_modules | grep -v '^\./build/'
# only docs/ prose — zero hits in src/
```

`rapier3d-compat` is the *compat* build precisely because it inlines its WASM and needs no
side-car file. So this passenger is **1.57 MB deployed on every release, never fetched by anything,
and skewed from the engine the game actually runs.** It is the single worst instance of the class
this task is about: unhashed, so its name never changes; unreferenced, so nothing errors; stale,
so anyone who does diff it against the running engine gets a false signal.

It is declared in the guard's inventory because removing it is a fix, and fixes are scheduled
separately. **Recommend deleting `public/rapier.wasm`** and dropping its line from
`EXPECTED_PASSENGERS`. That is −1.57 MB per deploy for a one-line change, and it should be
verified against `deploy.py`'s expectations by whoever owns that file this week.

### 6.2 `public/index.html` is a blank page waiting to happen

`public/index.html` exists and is a **script-less duplicate** of the root `index.html` template —
same markup, but with no `<script type="module">` and no `build-id` meta.

Vite copies `publicDir` into `outDir` and *then* writes the generated `index.html`, so the
generated document wins today; the shipped file is 812 bytes and correct. But the correct outcome
depends entirely on that ordering, for a file that has no reason to exist. If the order ever
inverted — a Vite change, a plugin, a `build_and_patch.py` step — **the deploy would serve a
syntactically valid page that loads no JavaScript at all.** No build error, no 404, no console
error. A blank `<div id="root">`.

This is the one unhashed file whose failure mode is total and silent, which is why guard assertion
2 checks the *outcome* (is `build/index.html` the generated document?) rather than trusting the
ordering. **Recommend deleting `public/index.html`.**

### 6.3 The 23 `.mp3`s are 6 placeholder stubs

All 23 `sounds/*.mp3` are **exactly 17,180 bytes**, and there are only **6 distinct sha256 values**
among them. `ambient_canyon`, `ambient_water`, `ambient_wind`, and `rapids_roar` are the same file;
so are all four `collide_*` plus `land_hard`/`land_impact`/`land_soft`/`raft_creak`; and so on.

These are placeholders, not audio. Not a defect — but worth recording, because 23 unhashed files
carrying 6 payloads will be replaced *in place* when real audio lands, one name at a time, with no
hash to signal it. That is precisely the deploy-invisibility this contract exists to cover, and
guard assertion 1 covers it.

### 6.4 `build:wasm`'s skip is silent in the one place it matters

When `emcc` is absent, `build.sh` exits 0 and the build proceeds against committed artifacts. The
stamp mechanism keeps that *coherent* — `wasmArtifactStamp.ts` still describes the committed pair,
and guard assertion 5 confirms it. So a skipped WASM build cannot produce a mismatched pair; it can
only produce an **old** one, which the stamp in `BUILD_ID` makes visible. Recording this because it
is the rare case where the existing design is already right, and the deploy audit's concern about
a `26999/33817`-byte pair being live is a *staleness* problem, not an incoherence one.

---

## 7. `pnpm audit`

47 advisories: **32 high, 13 moderate, 2 low**. Grouped by package, with the distinction the task
asked for — what the Three.js r168 pin (epic **#419**) blocks, versus what is independently fixable.

### Ships to the browser (1 group)

| Severity | Package | Path | Patched | Blocked by #419? |
|---|---|---|---|---|
| **high** ×7 | `fast-uri@3.1.0` | `. > ajv > fast-uri` | `>=3.1.6` | **No — independently fixable** |

The only advisory group reachable in a production build. `ajv@8.18.0` is a direct dependency
bundled into the entry chunk ([§4](#4-chunk-sizes-against-budget)); `fast-uri` is its URI resolver.
Seven advisories, all host-confusion / SSRF / path-traversal in URI parsing. Nothing to do with
`three`. A `pnpm.overrides` entry for `fast-uri@^3.1.6` resolves all seven without touching
`ajv`'s own version. **Highest-value independently fixable item in the audit.** The exposure is
limited (these paths are reached when resolving `$ref`/`$id` URIs in schemas the project authors
itself, not attacker-supplied ones), so this is a hygiene fix rather than an incident — and it
disappears entirely if `ajv` stops shipping to the browser at all.

### Blocked by the r168 pin (1 group)

| Severity | Package | Path | Patched | Notes |
|---|---|---|---|---|
| moderate ×2 | `fflate@0.6.10` | `. > three-stdlib@2.36.1 > fflate` | `>=0.6.11` | `three-stdlib` 2.36.1 tracks r168 |
| moderate ×2 | `fflate@0.8.2` | `. > @types/three@0.168.0 > fflate` | `>=0.8.3` | types only, never shipped |

The only group genuinely gated on #419. Both are `unzipSync` infinite-loop-on-malformed-archive;
**neither reaches the bundle** — verified, `fflate` does not appear in any `build/assets/*.js`
(`three-stdlib`'s zip loaders are tree-shaken out, and `@types/three` is types-only). Low urgency,
and correctly deferred to the epic. Note `three@0.168.0` itself carries **no advisory** — the pin
blocks this one transitive `fflate`, and nothing else in the audit.

### Independently fixable, build/test tooling only (never shipped)

| Severity | Package | Path | Patched |
|---|---|---|---|
| high ×1, moderate ×1 | `vite` | `. > vite` | `>=7.3.5` |
| high ×4, moderate ×2 | `postcss` | `. > vite > postcss` | `>=8.5.23` |
| high ×3 | `nanoid` | `. > vite > postcss > nanoid` | `>=3.3.18` |
| low ×1 | `esbuild` | `. > vite > esbuild` | `>=0.28.1` |
| high ×6, moderate ×1 | `brace-expansion` | `. > @vitest/coverage-v8 > … > brace-expansion` | `>=2.1.4` / `>=5.0.9` |
| high ×4 | `js-yaml` | `. > @react-three/eslint-plugin > eslint > js-yaml` | — |
| high ×2 | `picomatch` | `. > typescript-eslint > … > picomatch` | — |
| high ×2 | `ws` | `. > jsdom > ws` | — |
| high ×2 | `browserslist`, moderate ×1 `baseline-browser-mapping` | `. > @vitejs/plugin-react > @babel/core > …` | `>=2.11.0` |
| low ×1 | `@babel/core` | `. > @vitejs/plugin-react > @babel/core` | `>=7.29.6` |
| moderate ×1 | `vitest`, `@vitest/mocker` | `. > vitest > @vitest/mocker` | `>=4.1.11` |
| high ×8 | `basic-ftp`, `extract-zip`, `ip-address` | `. > puppeteer > @puppeteer/browsers > …` | — |

**None of these reach a player.** Several are Windows-only dev-server issues (`vite`'s
`server.fs.deny` bypass, `esbuild`'s file read) on a project whose own docs target Chrome on
non-Windows hosts. The `puppeteer` chain is `test:visual-smoke` only. Most clear with a
`pnpm update` of `vite` and `vitest`, which is independent of `three`.

### Actionable summary

1. **`fast-uri`** — the only shipped one. Override to `>=3.1.6`, or stop shipping `ajv`.
2. **`vite` → `>=7.3.5`** — clears `vite`, `postcss`, `nanoid`, `esbuild`: 9 advisories, one bump.
3. **`vitest` → `>=4.1.11`**, **`@vitejs/plugin-react`** — tooling, unblocked.
4. **`fflate`** — leave to #419. Not shipped, low urgency.

`pnpm audit` exits **1**, so it cannot be added to a CI gate as-is without a severity threshold or
an allowlist. Recording that as a fact, not proposing the gate.

---

## 8. Recommended `package.json` entry

`package.json` was **not modified**, per scope. The guard is worth wiring in. Add to `"scripts"`:

```json
    "check:build-manifest": "node scripts/check-build-manifest.mjs",
```

The script needs no arguments, no build step of its own, and no network. It expects `build/` to
exist and exits **2** (distinct from a contract failure's **1**) if it does not, so it is safe to
run unconditionally after `pnpm build`. It can also be pointed at a preserved output with
`--build-dir`, which is how the determinism comparison in [§2](#2-determinism-two-builds-compared)
was made.

It is deliberately **not** chained into `build`. A build that produced a bad manifest is exactly
the build you want to be able to inspect.

---

## 9. Which unhashed files deserve a guard

All 39, but for three different reasons and at three different strengths.

| Files | Recommendation | Why |
|---|---|---|
| `watershed_native.js` + `.wasm` | **Strongest guard — assertion 5.** | The one pair with a *cross-file* coherence requirement. Either alone is valid; mismatched they fail at runtime, in WASM, far from the cause. The stamp makes this verifiable for free. Already the tightest check in the guard. |
| `index.html` | **Guard the outcome, not the bytes — assertions 2, 3, 4.** | Its content legitimately changes every build ([§2](#2-determinism-two-builds-compared)), so byte comparison is useless. What must hold is structural: it is the generated document, every hash it names exists, and `BUILD_ID` agrees. Highest-consequence failure mode of anything in the tree ([§6.2](#62-publicindexhtml-is-a-blank-page-waiting-to-happen)). |
| 37 `public/` passengers | **sha256 identity against `public/`, plus a pinned inventory — assertions 1, 7.** | These are the month-long-bug class verbatim. A pinned inventory matters as much as the hashes: the failure that actually happened was not a corrupted file but an *unnoticed* one. |
| `BUILD_ID` | **Cross-check only — assertion 4.** | Its bytes are entropy by design. Its only invariant is agreeing with `index.html`. |
| `build/rapier.wasm` | **Guard now, then delete.** | Guarded as a passenger so the contract is complete, but it is 1.57 MB of dead, divergent weight ([§6.1](#61-rapiers-wasm-ships-three-times)). Delete it and remove the line. |
| `public/index.html` | **Guard the outcome, then delete.** | Not a passenger — an accident that Vite's copy ordering currently hides ([§6.2](#62-publicindexhtml-is-a-blank-page-waiting-to-happen)). |

Not recommended: hashing the passengers by giving them Vite-style names. They are referenced by
stable public URLs from game code (`resolvePublicAsset`), authored map JSON, and the audio system;
hashing them would mean an import-graph rewrite for files that change once a year. **sha256
identity verification at build time is the right strength for this class** — it gives the
self-verifying property the hashed assets get, without the naming churn.

The gap this contract does **not** close: it verifies `build/` against `public/`. It says nothing
about whether `build/` arrives on the server intact. That is `verify:deploy`'s job and
`DEPLOY_AUDIT.md`'s subject. The manifest is designed to be the input to that check — `--json`
emits path/size/sha256 for all 52 files in a form a deploy verifier can compare against a live
fetch.

---

## Appendix: reproducing this

```bash
pnpm install --frozen-lockfile
pnpm build
node scripts/check-build-manifest.mjs --manifest          # contract + manifest
node scripts/check-build-manifest.mjs --json /tmp/a.json  # machine-readable

# determinism check
cp -a build /tmp/runA && rm -rf build && pnpm build && cp -a build /tmp/runB
diff -qr /tmp/runA /tmp/runB     # expect: BUILD_ID, index.html, entry + 7 lazy chunks
```

Environment: Linux 6.18.44, Node 22.22.2, pnpm 10.33.0, tree at `736c0e0`, no `emcc` on `PATH`.
