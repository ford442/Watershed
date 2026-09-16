import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function readWasmArtifactStamp(): string {
  const stampFile = path.resolve('src/systems/water/wasmArtifactStamp.ts');
  try {
    const source = fs.readFileSync(stampFile, 'utf8');
    const match = source.match(/WASM_ARTIFACT_STAMP = '([^']+)'/);
    if (match) return match[1];
  } catch {
    /* stamp file missing in a fresh checkout before build:wasm */
  }
  return 'unknown';
}

function shortGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** Short SHA + WASM stamp + ISO time + an unpadded 0–255 nonce.
 *  ISO-8601 with milliseconds is fixed-width (two builds measured 807/820
 *  with identical lengths). The nonce is 1–3 decimal digits so index.html
 *  byte length moves, which is what Mechanism 2's size-skip keys on.
 *  Phase C also never size-skips index.html. */
const BUILD_IDENTITY = `${shortGitSha()} ${readWasmArtifactStamp()} ${new Date().toISOString()} n${randomBytes(1)[0]}`;

function buildIdentityPlugin(identity: string): Plugin {
  return {
    name: 'watershed-build-identity',
    transformIndexHtml(html) {
      return html.replaceAll('__WATERSHED_BUILD_ID__', identity);
    },
    writeBundle() {
      // writeBundle is production-build only. closeBundle also fires from
      // Vitest's Vite pipeline and would desync build/BUILD_ID from index.html.
      const outDir = path.resolve('build');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'BUILD_ID'), `${identity}\n`, 'utf8');
    },
  };
}

export default defineConfig({
  define: {
    __WATERSHED_ASSET_BASE__: JSON.stringify('./'),
    __WATERSHED_BUILD_IDENTITY__: JSON.stringify(BUILD_IDENTITY),
  },
  plugins: [react(), buildIdentityPlugin(BUILD_IDENTITY)],
  resolve: {
    // Prevent duplicate Three.js when three/webgpu is lazy-loaded in a separate chunk.
    dedupe: ['three'],
  },
  server: {
    port: 3000,
    headers: {
      // Required for SharedArrayBuffer (used by the --threads WASM build
      // and also by Rapier's multithreaded physics worker).
      // Safe to enable unconditionally in development.
      'Cross-Origin-Opener-Policy':   'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // Same COOP/COEP for `vite preview` so visual-smoke CI matches dev isolation.
  preview: {
    port: 4173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // Treat .wasm files as assets so Vite copies them to the output directory.
  assetsInclude: ['**/*.wasm'],
  base: './',
  build: {
    outDir: 'build',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-three':  ['three', '@react-three/fiber', '@react-three/drei'],
          'vendor-post':   ['postprocessing', '@react-three/postprocessing'],
          'vendor-rapier': ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
});
