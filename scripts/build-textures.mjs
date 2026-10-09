#!/usr/bin/env node
/**
 * build-textures — encode the canyon rock PBR set to KTX2 (dev-only, #466 Phase D).
 *
 *   KTX_BIN=/path/to/ktx node scripts/build-textures.mjs
 *
 * Needs KTX-Software's `ktx` CLI (v4.3+; https://github.com/KhronosGroup/KTX-Software/releases).
 * Not a build dependency: the outputs are committed under public/textures/, and
 * the game falls back to the JPGs when a GPU can't take a transcoded format
 * (src/rendering/ktx2Textures.ts). Re-run only when a source JPG changes.
 *
 * Encoding per map (all RGB, never single-channel: three samples roughness
 * from G and AO from R, and a single-channel KTX2 can transcode to BC4/EAC R11,
 * where G reads 0):
 *   Color             ETC1S (BasisLZ), sRGB transfer — albedo tolerates it best.
 *   NormalGL          UASTC + zstd, linear — ETC1S smears normals. Never
 *                     --normal-mode: it repacks to RGB=X, A=Y, and three's
 *                     normalMap reads RGB=XYZ.
 *   Roughness         UASTC + zstd, linear — drives specular, banding shows.
 *   AmbientOcclusion  ETC1S, linear.
 *   Displacement      ETC1S, linear.
 * Every map gets a full mip chain (the JPGs get theirs from the GPU at upload;
 * a compressed texture can't, so it ships them), and rows are stored
 * bottom-first (--convert-texcoord-origin bottom-left): a JPG is flipped by
 * three at upload (flipY), a compressed texture can't be, so the file carries
 * the flip and the two paths sample identical texels at identical UVs.
 *
 * Also copies three's Basis transcoder (examples/jsm/libs/basis) to
 * public/basis/, so KTX2Loader never reaches for a CDN.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');
const outDir = path.join(publicDir, 'textures');
const basisOut = path.join(publicDir, 'basis');
const ktx = process.env.KTX_BIN || 'ktx';

const ETC1S = ['--encode', 'basis-lz', '--clevel', '4', '--qlevel', '192'];
const UASTC = ['--encode', 'uastc', '--uastc-quality', '2', '--zstd', '18'];

/** Source JPG (public/) → KTX2 (public/textures/) and its encoder flags. */
export const ROCK_TEXTURES = [
  { src: 'Rock031_1K-JPG_Color.jpg', out: 'Rock031_Color.ktx2', args: ['--format', 'R8G8B8_SRGB', ...ETC1S] },
  { src: 'Rock031_1K-JPG_NormalGL.jpg', out: 'Rock031_NormalGL.ktx2', args: ['--format', 'R8G8B8_UNORM', '--assign-tf', 'linear', ...UASTC] },
  { src: 'Rock031_1K-JPG_Roughness.jpg', out: 'Rock031_Roughness.ktx2', args: ['--format', 'R8G8B8_UNORM', '--assign-tf', 'linear', ...UASTC] },
  { src: 'Rock031_1K-JPG_AmbientOcclusion.jpg', out: 'Rock031_AmbientOcclusion.ktx2', args: ['--format', 'R8G8B8_UNORM', '--assign-tf', 'linear', ...ETC1S] },
  { src: 'Rock031_1K-JPG_Displacement.jpg', out: 'Rock031_Displacement.ktx2', args: ['--format', 'R8G8B8_UNORM', '--assign-tf', 'linear', ...ETC1S] },
];

function checkKtx() {
  try {
    return execFileSync(ktx, ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    console.error(
      `build-textures: '${ktx}' not found. Install KTX-Software (v4.3+) from\n` +
        '  https://github.com/KhronosGroup/KTX-Software/releases\n' +
        'and put `ktx` on PATH, or set KTX_BIN=/path/to/ktx.',
    );
    process.exit(1);
  }
}

function main() {
  console.log(`build-textures: ${checkKtx()}`);
  fs.mkdirSync(outDir, { recursive: true });
  for (const { src, out, args } of ROCK_TEXTURES) {
    const input = path.join(publicDir, src);
    const output = path.join(outDir, out);
    execFileSync(ktx, ['create', ...args, '--generate-mipmap', '--convert-texcoord-origin', 'bottom-left', input, output], { stdio: 'inherit' });
    const kb = (bytes) => `${(bytes / 1024).toFixed(0)} kB`;
    console.log(`  ${src} (${kb(fs.statSync(input).size)}) → textures/${out} (${kb(fs.statSync(output).size)})`);
  }

  const basisSrc = path.join(rootDir, 'node_modules/three/examples/jsm/libs/basis');
  fs.mkdirSync(basisOut, { recursive: true });
  for (const file of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
    fs.copyFileSync(path.join(basisSrc, file), path.join(basisOut, file));
  }
  console.log('  three/examples/jsm/libs/basis → public/basis/');
}

main();
