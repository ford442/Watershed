import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

const rootDir = dirname(fileURLToPath(import.meta.url));
const threeWebgpuMock = resolve(rootDir, 'src/rendering/__mocks__/threeWebgpu.ts');

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.ts'],
      alias: {
        'three/webgpu': threeWebgpuMock,
        'three/tsl': threeWebgpuMock,
      },
    },
  }),
);
