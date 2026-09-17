# Build Hygiene — determinism, the unhashed-passenger contract, and chunk budgets

**Measured 2026-09-17 at `736c0e0`** (`pnpm@10.33.0`, `vite@7.3.2`, node as installed in the
session container). Read-only audit: nothing in the build pipeline was changed. `deploy.py`,
`build_and_patch.py`, `vite.config.ts`, `index.html`, `src/systems/water/`, `src/physics/`, and
`verification/` were read but not modified, per the task's scope lock. Findings only — the fixes
this doc recommends are scheduled separately.

Companion to [`DEPLOY_AUDIT.md`](./DEPLOY_AUDIT.md), which established *why* unhashed files are the
dangerous class. This doc establishes *which* files are in that class today, whether the build that
produces them is reproducible, and what a guard can assert about them.

---

## 0. Headline

| Question | Answer |
|---|---|
| Is `pnpm build` deterministic? | **No, and deliberately so.** 10 of 52 files differ between two consecutive builds of an unchanged tree. Every difference traces to one intentional cause. |
| Is the *rest* of it deterministic? | **Yes.** 42 of 52 files are byte-identical across runs, including all three `manualChunks` vendor bundles, the CSS bundle, and the Rapier worker. |
| Do the `public/` passengers arrive intact? | **Yes.** All 37, byte-identical to their sources, `watershed_native.js`/`.wasm` included. |
| Chunk budgets | `vendor-rapier` **unchanged** at 2,237,128 B (same content hash as 14 Aug). Entry bundle **grew to 1,814,776 B** from 1,769,922 B — +44,854 B / +2.5%. |
| Dead `shaders/` files | **Gone locally.** Neither `public/shaders/` nor `build/shaders/` exists, and the tree contains no `.wgsl` file at all. The 4 orphans on the server are purely a server-side residue. |
| `pnpm audit` | 47 advisories / 18 distinct packages. **Two are attributable to the Three r168 pin (#419), both `fflate`, and neither reaches shipped bytes.** The other 16 packages are independently fixable and all are build- or test-time only. |

---

## 1. Determinism: two builds, one tree

Method: `pnpm install`, `rm -rf build && pnpm build`, snapshot, `rm -rf build && pnpm build`,
snapshot, `sha256sum` every file in both. No source file changed between the runs.

**42 of 52 files byte-identical. 10 differ:**

| File | Differs? | Cause |
|---|---|---|
| `BUILD_ID` | yes | Contains `BUILD_IDENTITY` verbatim (see below). |
| `index.html` | yes | Carries `<meta name="build-id">` with `BUILD_IDENTITY`, **and** the entry `<script src>` whose hash moved. |
| `assets/index-*.js` (entry) | yes | `BUILD_IDENTITY` is inlined into it via Vite `define`. |
| `assets/{Canyon,River,Water,Sky,Weather}NodeMaterial-*.js`, `assets/{Critter,Foliage}NodeMaterials-*.js` (7 lazy chunks) | yes | **Cascade, not independent nondeterminism** — see below. |
| `assets/vendor-three-*.js` | no | — |
| `assets/vendor-rapier-*.js` | no | — |
| `assets/vendor-post-*.js` | no | — |
| `assets/rapier.worker-*.js` | no | — |
| `assets/index-*.css` | no | — |
| 37 `public/` passengers | no | — |

### The actual cause, traced

`vite.config.ts:35` builds a per-build identity string:

```
BUILD_IDENTITY = `${shortGitSha()} ${wasmArtifactStamp} ${new Date().toISOString()} n${randomBytes(1)[0]}`
```

Two consecutive runs produced:

```
736c0e0 4d5ade0f0dc990a0 2026-09-17T04:59:31.685Z n252
736c0e0 4d5ade0f0dc990a0 2026-09-17T04:59:46.753Z n37
```

Two of the four fields — the ISO timestamp and the 0–255 `randomBytes` nonce — are non-reproducible
**by design**. The config's own comment says why: the nonce is unpadded (1–3 decimal digits) so that
`index.html`'s *byte length* moves between builds, because `deploy.py`'s upload-skip predicate is
`local_size == remote_size` and nothing else (`DEPLOY_AUDIT.md` §2). A same-length `index.html` is
exactly how the live site ended up pointing at an Aug-14 bundle graph while an Aug-31 CSS file sat
unreachable on the server. **This is a deliberate trade of reproducibility for deploy correctness,
and on the evidence in `DEPLOY_AUDIT.md` it is the right trade.**

`BUILD_IDENTITY` is exposed as `__WATERSHED_BUILD_IDENTITY__` through Vite's `define`, so it is
substituted into the entry chunk's source text. That changes the entry chunk's bytes, therefore its
Rollup hash, therefore its filename — `index-BK63f8K3.js` in run A, `index-BocMC-Wv.js` in run B.

The 7 NodeMaterial chunks are **collateral**. They import bindings from the entry chunk, so each one
contains a literal import specifier naming it:

```
-  ...,y as R}from"./index-BK63f8K3.js"
+  ...,y as R}from"./index-BocMC-Wv.js"
```

That one string is the *entire* diff in each of those 7 files. Their own module content is stable;
they inherit the entry's churn through the import graph.

**So: exactly one root cause (timestamp + nonce in `BUILD_IDENTITY`), one file it is inlined into
(the entry chunk), and a 7-file hash cascade downstream of that.** No embedded build timestamp
anywhere else, no non-deterministic module or chunk ordering, no unstable minifier output. Strip the
two volatile fields out of `BUILD_IDENTITY` and this build is bit-for-bit reproducible.

**Consequence for deploys:** every build uploads ≥10 new/changed files even when nothing changed,
and leaves the 8 previous hashed files orphaned on the server forever, because `deploy.py` has no
delete path. At ~1.9 MB per orphaned entry+cascade set, the 278 MB `assets/` directory
`DEPLOY_AUDIT.md` §3 found is the arithmetic of this working as intended over time. The right fix is
server-side pruning, not reproducibility.

---

## 2. The manifest contract

`build/` is **52 files, 15.3 MB**, in three kinds:

| Kind | Count | Self-verifying? | Path shape |
|---|---|---|---|
| `hashed-asset` | 13 | **Yes** — different bytes ⇒ different filename | `assets/<name>-<8 base64url chars>.<ext>` |
| `generated-unhashed` | 2 | No | `index.html`, `BUILD_ID` |
| `passenger` (copied verbatim from `public/`) | 37 | No | mirrors `public/` exactly |

`13 + 2 + 37 = 52`. ✅

### The 37 passengers

| Group | Count |
|---|---|
| `Rock031.png` + 5 `Rock031_1K-JPG_*.jpg` | 6 |
| `collision.wav` | 1 |
| `levels/` (`README.md`, `autumn-rapids.json`, `devils-gorge.json`, `gentle-creek.json`) | 4 |
| `rapier.wasm` | 1 |
| `sounds/*.mp3` | 23 |
| `watershed_native.js`, `watershed_native.wasm` | 2 |

**All 37 verified sha256-identical to their `public/` sources**, in both builds. Vite's `publicDir`
copy is a plain byte copy with no transform, and the measurement confirms it.

> **Correction to `DEPLOY_AUDIT.md` §1.** That table says "36" passengers but enumerates 38 items
> (its own list sums to 38 with `shaders/heightmap_flow.wgsl` included). The count was off. The
> correct figure at the time was 38; today it is **37**, because `shaders/heightmap_flow.wgsl` is
> gone from the tree (§4).

### `watershed_native.js` / `.wasm` — pair coherence

Both halves are present and byte-identical to `public/`. **But this build did not produce them.**
`pnpm build` runs `build:wasm` first, and `emscripten/build.sh` detects that `emcc` is not on `PATH`,
prints `[build:wasm] Emscripten not found — skipping WASM compile`, and exits 0. The build then
ships the pair already committed to `public/` (27,029 B and 33,840 B). Unchanged since the
`DEPLOY_AUDIT.md` run, and the same graceful-skip behaviour.

This means **the "same emcc invocation" property cannot be verified from a build in this
environment** — the build is a passthrough, and the guarantee lives entirely in whatever commit
last updated the two files in `public/`. The evidence that this guarantee has already been broken
once is in `DEPLOY_AUDIT.md` §3: the live `.js` half is dated 14 Aug and the live `.wasm` half
31 Aug, i.e. the deployed pair is *split across two different emcc outputs*. A local guard can assert
the pair is coherent between `public/` and `build/` (and that neither half ships alone); it cannot
assert the two halves came from one compile. Only `WATERSHED_REQUIRE_WASM=1` in CI, plus the
`wasmArtifactStamp` already threaded into `BUILD_IDENTITY`, can do that.

### `public/index.html` is a shadowed stray

`public/` holds 38 files; only 37 are passengers. The 38th is `public/index.html` (310 B, a bare
CRA-era stub with an empty `<div id="root">` and no script tag). Vite writes its own generated
`index.html` (811 B, from the repo-root template) to the same output path, so the stub is silently
overwritten and never ships. **Harmless today, but it is a 310-byte file whose only possible effect
is to ship a blank page if Vite's write order ever changes.** It should be deleted — but not by this
task, since the root `index.html` is under another agent's scope lock. The guard treats it as
explicitly shadowed rather than as a missing passenger.

---

## 3. Chunk sizes against the budgets

Project budgets are runtime targets (60 FPS, < 300 MB memory post-load), not bundle-size limits, so
these are reported against the *last measurement* rather than a threshold.

| Chunk | Bytes | gzip | vs. last measurement |
|---|---:|---:|---|
| `assets/index-*.js` (entry) | 1,814,776 | 530.9 kB | **1,769,922 → +44,854 B (+2.5%)** |
| `assets/vendor-rapier-*.js` | 2,237,128 | 830.3 kB | **unchanged — byte-identical, hash still `DW2HfIcf`** |
| `assets/vendor-three-*.js` | 1,068,786 | 300.2 kB | ~unchanged (1,074,543 live on 14 Aug, −5.7 kB) |
| `assets/vendor-post-*.js` | 700 | 0.4 kB | unchanged |
| `assets/index-*.css` | 30,457 | 5.9 kB | 28,662 → +1,795 B |
| `assets/rapier.worker-*.js` | 2,244,843 | — | not previously measured |
| 7 lazy NodeMaterial chunks | 24,760 total | — | not previously measured |

**Does "2.2 MB / 1.77 MB" still hold?** `vendor-rapier` does, exactly — same hash, same bytes,
unmoved since at least 14 Aug. The entry bundle does not: it is now 1.81 MB, having grown 2.5% in
roughly five weeks. That rate is unremarkable for feature work and is not by itself a flag.

### The one thing that is a flag: Rapier ships three times

`build/assets/` is 7.42 MB. Nearly 6 MB of it is Rapier, in three copies of the same WASM:

- `vendor-rapier-*.js` — 2,237,128 B, of which a **2,092,530-byte contiguous base64 run**
- `rapier.worker-*.js` — 2,244,843 B, containing **the same 2,092,530-byte base64 run**
- `public/rapier.wasm` → `build/rapier.wasm` — 1,569,588 B, the same module as raw bytes

`@dimforge/rapier3d-compat` inlines its WASM as base64, and the physics worker pulls in its own copy
of the compat module, so Rollup emits the blob twice. Base64 is a 33% size tax on top of that, and
the standalone `rapier.wasm` passenger is a third delivery path for the same engine.

This does not cost 60 FPS — it is download and parse cost, not frame cost — but it is the single
largest line in the build by a wide margin, and it is duplication rather than content. Worth an
issue against the physics-worker chunking; out of scope here (`src/physics/` is scope-locked).

`vendor-post` at **700 bytes** is the other oddity, and it is expected: `CLAUDE.md` already records
that nothing imports `@react-three/postprocessing`, and `vite.config.ts` names it in `manualChunks`
anyway. The chunk is a near-empty stub kept alive by the `manualChunks` entry alone. Both
`postprocessing` and `@react-three/postprocessing` are listed for that chunk, so the 700 bytes are
what survives when neither is actually reachable from the entry graph.

---

## 4. Dead-file situation: confirmed clean locally

`DEPLOY_AUDIT.md` §3 found 5 files in the server's `shaders/` directory where the build produces 1,
leaving `sky.wgsl`, `terrain.wgsl`, `tree.wgsl`, `water.wgsl` as orphans.

Today the count is not 1 — it is **0**:

- `public/shaders/` **does not exist**.
- `build/shaders/` **does not exist**.
- `find . -name '*.wgsl' -not -path './node_modules/*'` returns **nothing**. There is no `.wgsl` file
  anywhere in the tree, `heightmap_flow.wgsl` included.

The shader source directory is gone too — the WGSL path has left the tree entirely rather
than being relocated into a `.ts` module. (`CLAUDE.md`'s directory map and key-file table still name
a `HeightmapFlow.ts` under a since-deleted shaders folder; both entries are stale. Correcting them is a docs
fix for a separate commit.) So the local side is clean, and the guard can assert `build/shaders/`
never reappears.

**All 5 server-side `shaders/*.wgsl` are now orphans**, not 4 — `heightmap_flow.wgsl` joined the
other four when the runtime stopped shipping it. Nothing local can remove them; `deploy.py` has no
delete path, and it is scope-locked. This needs a one-off manual cleanup on the VPS, tracked
alongside the 179 orphaned `assets/` files.

---

## 5. `pnpm audit`

**47 advisories across 18 distinct packages: 32 high, 13 moderate, 2 low.** Exit code 0 (pnpm does
not fail the command on findings).

### Attributable to the Three r168 pin (epic #419) — 2 advisories, 1 package

| Package | Path | Have | Needs | Ships to browser? |
|---|---|---|---|---|
| `fflate` | `three-stdlib@2.36.1 > fflate@0.6.10` | 0.6.10 | ≥ 0.6.11 | **No** |
| `fflate` | `@types/three@0.168.0 > fflate@0.8.2` | 0.8.2 | ≥ 0.8.3 | **No** (types-only devDependency) |

Both are the same moderate advisory (`unzipSync` infinite loop on a malformed archive).
`three-stdlib@2.36.1` is the release matched to three r168 — it is reached through
`@react-three/drei@10.7.7` and `@react-three/rapier@2.2.0` as well as directly — so moving off
`fflate@0.6.10` means moving `three-stdlib`, which means unpinning three. **Genuinely blocked by
#419.**

It is also **unreachable**: `grep` for `fflate` across every emitted chunk in `build/assets/` returns
zero hits. Rollup tree-shakes it out — nothing in the app uses the `three-stdlib` loaders that pull
it in. The advisory requires calling `unzipSync` on attacker-supplied bytes; that code is not in the
shipped bundle at all.

### Independently fixable — 45 advisories, 17 packages

None of these are blocked by the three pin, and **none of them ship**: every one is a build-time,
lint-time, or test-time dependency.

| Package | Sev | Chain | Note |
|---|---|---|---|
| `fast-uri` | high ×7 | `ajv@8.18.0 > fast-uri@3.1.0` | Needs ≥ 3.1.6. `ajv` is a *runtime* dependency (`levelValidator`, `reachValidator`, `PersistenceSystem`) — but `fast-uri` appears **0 times** in the emitted bundle. Highest-count finding; a direct `ajv` bump is the fix. |
| `nanoid` | high ×3 | `vite > postcss > nanoid@3.3.11` | Build-time only. Fixed by a `vite`/`postcss` bump. |
| `postcss` | high ×2, mod ×2 | `vite > postcss@8.5.6` | Build-time only. Needs ≥ 8.5.23. |
| `vite` | mod ×2 | direct, `vite@7.3.2` | Needs ≥ 7.3.5. Dev-server issues (`server.fs.deny` bypass, launch-editor NTLM) — not a production-build concern, but it is a one-line bump. |
| `esbuild` | low ×1 | `vite > esbuild` | Windows dev server only. |
| `browserslist`, `baseline-browser-mapping`, `@babel/core` | high ×2, mod ×1, low ×1 | `@vitejs/plugin-react > @babel/core > …` | Build-time only. |
| `basic-ftp`, `extract-zip`, `ip-address` | high ×6, mod ×2 | `puppeteer@24.40.0 > …` | devDependency, visual-smoke only. |
| `vitest`, `@vitest/mocker`, `brace-expansion`, `ws`, `picomatch`, `js-yaml` | mod ×16 | test/lint toolchain | Test-time only. |

**Actionable, in order:** bump `ajv` (clears 7 highs, the largest single block), then `vite` (clears
`nanoid`, `postcss`, `esbuild`, and its own 2 — 8 more), then `@vitejs/plugin-react` and
`puppeteer`/`vitest` as routine devDependency maintenance. That is 16 of 18 packages cleared without
touching three. The remaining 2 wait on #419 and are inert in the meantime.

---

## 6. Recommendation: which unhashed files deserve a guard

All 39 of them, but for two different reasons.

**The 37 passengers need an integrity guard.** They have no content hash, the deploy's skip
predicate is byte-size equality, and a file whose bytes change without its length changing is
invisible to it. The guard asserts the build's copy matches the `public/` source and that the
passenger *set* has not silently changed.

**`index.html` and `BUILD_ID` need a coherence guard.** `index.html` is the one file that determines
which hashed bundle the browser loads. A build that emits an `index.html` pointing at a file not in
`build/` is broken *before* it reaches the deploy, and that is cheap to catch.

Shipped as **[`scripts/check-build-manifest.mjs`](../../scripts/check-build-manifest.mjs)**.
Standalone, node-core only, no arguments or environment required:

```bash
pnpm build
node scripts/check-build-manifest.mjs
node scripts/check-build-manifest.mjs --manifest build-manifest.tsv   # path/bytes/sha256/hashed/kind
node scripts/check-build-manifest.mjs --json                          # machine-readable
```

Six assertions:

1. Every `public/` passenger is in `build/`, sha256-identical to its source.
2. No unhashed file exists in `build/` without a `public/` source or a declared generated-file
   carve-out — a stray passenger is a file the deploy will ship forever and never delete.
3. The passenger count matches the contract constant (37), so changing `public/` requires a
   deliberate one-line edit in the same commit.
4. `watershed_native.js` and `.wasm` are both present or both absent — never half-shipped.
5. `build/index.html` references at least one `./assets/*` file, every reference exists on disk, and
   every reference carries an 8-character Rollup hash.
6. `build/shaders/` does not exist (§4).

Each assertion was verified to fire by tampering with a real build: appending a byte to
`build/watershed_native.js`, creating `build/shaders/dead.wgsl`, and deleting
`build/assets/vendor-post-*.js` produced 4 correct violations and exit 1. A clean build passes.

### Suggested `package.json` entry — **not added by this task** (`package.json` is scope-locked)

Add to `"scripts"`:

```json
    "check:build-manifest": "node scripts/check-build-manifest.mjs",
```

Note this deliberately does **not** chain onto `"build"`. `build_and_patch.py` and `deploy.py` are
owned elsewhere this week; wiring the guard into the deploy path is a decision for whoever owns it.
As a standalone script it is useful immediately and couples to nothing.

### What the guard cannot do

- It cannot prove `watershed_native.js`/`.wasm` came from one emcc invocation (§2). That needs
  `WATERSHED_REQUIRE_WASM=1` in CI.
- It cannot detect server-side orphans. `deploy.py` has no delete path; the 179 `assets/` and 5
  `shaders/` orphans need a manual VPS cleanup.
- It cannot make the build reproducible, and should not try — the nondeterminism in
  `BUILD_IDENTITY` is load-bearing for deploy correctness (§1).
