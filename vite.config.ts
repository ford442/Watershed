import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
  // Treat .wasm files as assets so Vite copies them to the output directory.
  assetsInclude: ['**/*.wasm'],
  base: './',
  build: {
    outDir: 'build',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-three':  ['three', '@react-three/fiber', '@react-three/drei'],
          'vendor-webgpu': ['three/webgpu'],
          'vendor-post':   ['postprocessing', '@react-three/postprocessing'],
          'vendor-rapier': ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
});