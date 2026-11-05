#!/usr/bin/env node
/**
 * build-assets — the authored-asset pipeline (#536 A.1).
 *
 *   node scripts/build-assets.mjs           # assets/src/<pack>/*.glb → public/packs/<pack>/
 *   node scripts/build-assets.mjs --check   # rebuild in memory; exit 1 if public/packs/ differs
 *
 * Every source `assets/src/<pack>/<name>.glb` (with an optional sidecar `<name>.json`, see
 * below) becomes `public/packs/<pack>/<name>.glb`:
 *   - dedup + weld (indexed geometry, one copy of each accessor / material);
 *   - baked LODs: each sidecar level after the first re-reads the source and runs meshopt's
 *     simplifier at that level's ratio / error, so a level never simplifies a simplified mesh;
 *     each level is a root child node named `lod<N>` (no dots: GLTFLoader strips them);
 *   - meshopt compression (EXT_meshopt_compression + KHR_mesh_quantization; three's own
 *     MeshoptDecoder reads it, no Draco);
 * and one `public/packs/<pack>/manifest.json` per pack lists every asset with its byte size,
 * sha256, source hash, bounds (from the uncompressed source) and LOD ladder. The game reads
 * only the manifest (src/assets/packManifest.ts) and the files it names.
 *
 * Reproducible on purpose: no timestamps, sorted inputs, the encoder versions pinned in
 * package.json (and recorded in the manifest), so the same sources give the same bytes on any
 * machine. CI runs `--check`, the asset twin of the WASM stamp diff: a source edited without a
 * rebuild, or a hand-edited output, fails the build.
 *
 * Sidecar (`<name>.json`, optional):
 *   { "lods": [ { "distance": 0 },
 *               { "ratio": 0.5, "error": 0.01, "distance": 18 }, … ] }
 * `distance` is the camera distance (m) from which a level is drawn (THREE.LOD semantics);
 * the first level is the source itself and must be at distance 0. No sidecar = one level.
 *
 * Textures: none of the phase-A sources carry images. When a pack needs them, they are
 * encoded with `toktx`/`ktx` like scripts/build-textures.mjs and referenced via KHR_texture_basisu;
 * the manifest's `textures` flag tells the runtime to bring KTX2Loader.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, mergeDocuments, prune, simplify, unpartition, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(rootDir, 'assets', 'src');
// Not public/assets/: Vite emits its hashed chunks to build/assets/, and the build gate
// (check-build-manifest.mjs) requires every file there to carry a content hash.
const outRoot = path.join(rootDir, 'public', 'packs');
const MANIFEST_SCHEMA = 1;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const round = (n) => Math.round(n * 1e4) / 1e4;

function toolVersions() {
  const version = (pkg) =>
    JSON.parse(fs.readFileSync(path.join(rootDir, 'node_modules', pkg, 'package.json'), 'utf8')).version;
  return {
    '@gltf-transform/core': version('@gltf-transform/core'),
    '@gltf-transform/functions': version('@gltf-transform/functions'),
    meshoptimizer: version('meshoptimizer'),
  };
}

function readSidecar(file) {
  if (!fs.existsSync(file)) return { lods: [{ distance: 0 }] };
  const sidecar = JSON.parse(fs.readFileSync(file, 'utf8'));
  const lods = sidecar.lods ?? [{ distance: 0 }];
  if (!Array.isArray(lods) || lods.length === 0) throw new Error(`${file}: lods must be a non-empty array`);
  lods.forEach((lod, i) => {
    if (typeof lod.distance !== 'number' || lod.distance < 0) throw new Error(`${file}: lods[${i}].distance must be >= 0`);
    if (i === 0 && lod.distance !== 0) throw new Error(`${file}: lods[0] is the source and must be at distance 0`);
    if (i > 0 && lod.distance <= lods[i - 1].distance) throw new Error(`${file}: lod distances must increase`);
    if (i > 0 && !(lod.ratio > 0 && lod.ratio < 1)) throw new Error(`${file}: lods[${i}].ratio must be in (0, 1)`);
  });
  return { lods };
}

function triangleCount(scene) {
  let tris = 0;
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  });
  return tris;
}

/** Wrap a scene's current root children in one node, so a level is one subtree. */
function wrapRoots(doc, scene, name) {
  const wrapper = doc.createNode(name);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    wrapper.addChild(child);
  }
  return wrapper;
}

async function readLevel(io, sourceBytes, lod) {
  const doc = await io.readBinary(sourceBytes);
  await doc.transform(dedup(), weld());
  if (lod.ratio !== undefined) {
    await doc.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio: lod.ratio, error: lod.error ?? 0.01, lockBorder: false }),
    );
  }
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw new Error('source has no scene');
  return { doc, scene };
}

async function buildAsset(io, pack, name) {
  const sourceFile = path.join(srcRoot, pack, `${name}.glb`);
  const sidecarFile = path.join(srcRoot, pack, `${name}.json`);
  const sourceBytes = new Uint8Array(fs.readFileSync(sourceFile));
  const { lods } = readSidecar(sidecarFile);

  // Bounds from the uncompressed source (quantisation moves vertices by < 1 mm, but the
  // manifest should describe the authored shape, not the encoding).
  const probe = await io.readBinary(sourceBytes);
  const probeScene = probe.getRoot().getDefaultScene() ?? probe.getRoot().listScenes()[0];
  const { min, max } = getBounds(probeScene);
  const center = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
  const radius = Math.hypot(max[0] - center[0], max[1] - center[1], max[2] - center[2]);

  const base = await readLevel(io, sourceBytes, lods[0]);
  const out = base.doc;
  const outScene = base.scene;
  outScene.setName(name);
  const ladder = [];
  outScene.addChild(wrapRoots(out, outScene, 'lod0'));
  ladder.push({ distance: 0, triangles: triangleCount(outScene) });

  for (let i = 1; i < lods.length; i += 1) {
    const level = await readLevel(io, sourceBytes, lods[i]);
    const triangles = triangleCount(level.scene);
    const map = mergeDocuments(out, level.doc);
    const merged = map.get(level.scene);
    const wrapper = wrapRoots(out, merged, `lod${i}`);
    merged.dispose();
    outScene.addChild(wrapper);
    ladder.push({ distance: lods[i].distance, triangles });
  }
  out.getRoot().setDefaultScene(outScene);

  await out.transform(
    unpartition(), // mergeDocuments brings each level's buffer; a GLB has one
    dedup(),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  out.getRoot().getAsset().generator = 'watershed scripts/build-assets.mjs';
  const textures = out.getRoot().listTextures().length > 0;
  const bytes = await io.writeBinary(out);

  const sidecarBytes = fs.existsSync(sidecarFile) ? fs.readFileSync(sidecarFile) : Buffer.alloc(0);
  return {
    bytes,
    entry: {
      file: `${name}.glb`,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      sourceSha256: sha256(Buffer.concat([Buffer.from(sourceBytes), Buffer.from('\0'), sidecarBytes])),
      bounds: {
        min: min.map(round),
        max: max.map(round),
        center: center.map(round),
        radius: round(radius),
      },
      lods: ladder,
      textures,
    },
  };
}

/** Build every pack in memory: { pack → { files: Map<name, bytes>, manifest } }. */
async function buildAll() {
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .setLogger(new Logger(Logger.Verbosity.WARN))
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const tools = toolVersions();
  const packs = new Map();
  if (!fs.existsSync(srcRoot)) return packs;
  for (const pack of fs.readdirSync(srcRoot).sort()) {
    const packDir = path.join(srcRoot, pack);
    if (!fs.statSync(packDir).isDirectory()) continue;
    if (!/^[a-z][a-z0-9-]*$/.test(pack)) throw new Error(`pack id '${pack}' must be lower-case kebab`);
    const names = fs
      .readdirSync(packDir)
      .filter((f) => f.endsWith('.glb'))
      .map((f) => f.slice(0, -4))
      .sort();
    const files = new Map();
    const assets = {};
    for (const name of names) {
      if (!/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/.test(name)) {
        throw new Error(`${pack}/${name}.glb: asset names are dotted prop ids, e.g. raft.hull.default`);
      }
      const { bytes, entry } = await buildAsset(io, pack, name);
      files.set(entry.file, bytes);
      assets[name] = entry;
    }
    // The pack stamp addresses every file of this build (like WASM_ARTIFACT_STAMP): the
    // runtime appends ?v=<stamp> to each fetch, so a stamped URL is content-addressed.
    const stamp = sha256(names.map((n) => `${n}\0${assets[n].sha256}\n`).join('')).slice(0, 16);
    const manifest = { schema: MANIFEST_SCHEMA, pack, stamp, tools, assets };
    files.set('manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    packs.set(pack, { files, manifest });
  }
  return packs;
}

function listOutput() {
  const found = new Map();
  if (!fs.existsSync(outRoot)) return found;
  for (const pack of fs.readdirSync(outRoot).sort()) {
    const dir = path.join(outRoot, pack);
    if (!fs.statSync(dir).isDirectory()) continue;
    found.set(pack, fs.readdirSync(dir).sort());
  }
  return found;
}

async function main() {
  const check = process.argv.includes('--check');
  const packs = await buildAll();
  const existing = listOutput();
  const problems = [];

  for (const [pack, { files, manifest }] of packs) {
    const dir = path.join(outRoot, pack);
    if (!check) fs.mkdirSync(dir, { recursive: true });
    for (const [file, bytes] of files) {
      const target = path.join(dir, file);
      const current = fs.existsSync(target) ? fs.readFileSync(target) : null;
      const same = current !== null && Buffer.compare(current, Buffer.from(bytes)) === 0;
      if (check) {
        if (!same) problems.push(`public/packs/${pack}/${file} ${current ? 'differs from' : 'is missing from'} its sources`);
      } else if (!same) {
        fs.writeFileSync(target, bytes);
      }
    }
    for (const file of existing.get(pack) ?? []) {
      if (files.has(file)) continue;
      if (check) problems.push(`public/packs/${pack}/${file} has no source in assets/src/${pack}/`);
      else fs.rmSync(path.join(dir, file));
    }
    const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
    for (const [name, a] of Object.entries(manifest.assets)) {
      const tris = a.lods.map((l) => l.triangles).join(' / ');
      console.log(`  ${pack}/${name}: ${kb(a.bytes)}, ${a.lods.length} LOD (${tris} tris)`);
    }
    console.log(`build-assets: pack '${pack}' stamp ${manifest.stamp}`);
  }
  for (const pack of existing.keys()) {
    if (packs.has(pack)) continue;
    if (check) problems.push(`public/packs/${pack}/ has no source pack in assets/src/`);
    else fs.rmSync(path.join(outRoot, pack), { recursive: true });
  }

  if (problems.length > 0) {
    console.error('build-assets --check: public/packs/ is not what assets/src/ builds to:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('Run `pnpm build:assets` and commit public/packs/.');
    process.exit(1);
  }
  if (check) console.log('build-assets --check: ok — public/packs/ matches assets/src/.');
}

await main();
