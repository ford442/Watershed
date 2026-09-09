import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error — plain ESM helper shared with deploy tooling (no types).
import { BUILD_IDENTITY_FILENAME, resolveBuildIdentity } from './scripts/buildIdentity.mjs';

/**
 * Resolve the build identity ONCE per Vite run and expose it two ways:
 *   - `__WATERSHED_BUILD_IDENTITY__` (compile-time define → src/buildIdentity.ts →
 *     `window.__WATERSHED_BUILD__`)
 *   - `build/build-identity.json` (fetchable without executing the app; consumed by
 *     deploy.py's coherence check and verification/verify_deploy.mjs)
 * Same object, one source of truth — they cannot drift.
 */
function buildIdentityPlugin(): Plugin {
  const identity = resolveBuildIdentity();
  return {
    name: 'watershed-build-identity',
    config() {
      return {
        define: {
          __WATERSHED_BUILD_IDENTITY__: JSON.stringify(JSON.stringify(identity)),
        },
      };
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: BUILD_IDENTITY_FILENAME,
        source: `${JSON.stringify(identity, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  define: {
    __WATERSHED_ASSET_BASE__: JSON.stringify('./'),
  },
  plugins: [react(), buildIdentityPlugin()],
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