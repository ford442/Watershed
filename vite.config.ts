import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  base: './',
  build: {
    outDir: 'build',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-three': ['three', '@react-three/fiber', '@react-three/drei'],
          'vendor-post': ['postprocessing', '@react-three/postprocessing'],
          'vendor-rapier': ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
});