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

/** `build.sourcemap: 'hidden'` writes `*.map` next to the chunks without a
 *  sourceMappingURL comment. Move them out of build/ so the deploy zip and
 *  check-build-manifest never see them; keep them in build-sourcemaps/ to
 *  symbolicate field crashes (#465 B). */
function sourcemapsOutOfBuildPlugin(): Plugin {
  return {
    name: 'watershed-sourcemaps-out-of-build',
    apply: 'build',
    writeBundle(options) {
      const outDir = path.resolve(options.dir ?? 'build');
      const mapsDir = path.resolve('build-sourcemaps');
      fs.rmSync(mapsDir, { recursive: true, force: true });
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const from = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(from);
          } else if (entry.name.endsWith('.map')) {
            const to = path.join(mapsDir, path.relative(outDir, from));
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.renameSync(from, to);
          }
        }
      };
      walk(outDir);
    },
  };
}

/** One Rapier wasm, shipped once, as a real hashed asset (#485 B).
 *
 *  `@dimforge/rapier3d-compat` inlines its 1.57 MB `.wasm` as a 2.09 M-char
 *  base64 literal and decodes it in `init()`. Bundled into both the main-thread
 *  `<Physics>` world and `physics/rapier.worker.ts`, that was two copies of the
 *  bytes as JS text (+33 %, all through the JS parser). `-compat`'s `init()`
 *  takes no argument and `@react-three/rapier` hard-codes
 *  `import('@dimforge/rapier3d-compat'); r.init()` against a peer-dep pin, while
 *  the non-compat package has no `init()` at all — so neither swapping packages
 *  nor passing `module_or_path` is available without forking r3r. Instead this
 *  rewrites the one decode site so the glue's own wasm-bindgen loader is handed
 *  the asset URL (it already accepts a URL: fetch + instantiateStreaming).
 *
 *  Safety: the literal must decode to exactly the `.wasm` file shipped in the
 *  package, and the pattern must match exactly once, or the build fails — a
 *  rapier bump that moves either is a build error, never a silent re-inline.
 *  Build only: dev's dependency optimizer and vitest keep the stock package.
 *  Registered for the worker build too (`worker.plugins`); both emit the same
 *  content-hashed file name, so build/assets holds a single copy. */
const RAPIER_COMPAT_ESM = /[\\/]@dimforge[\\/]rapier3d-compat[\\/]rapier\.mjs$/;
const RAPIER_WASM_DECODE = /yield (\w+)\((\w+)\.toByteArray\("([A-Za-z0-9+/=]{100000,})"\)\.buffer\)/g;

function rapierWasmAssetPlugin(): Plugin {
  const wasmFile = path.resolve('node_modules/@dimforge/rapier3d-compat/rapier_wasm3d_bg.wasm');
  return {
    name: 'watershed-rapier-wasm-asset',
    apply: 'build',
    transform(code, id) {
      if (!RAPIER_COMPAT_ESM.test(id.split('?')[0])) return null;
      const sites = [...code.matchAll(RAPIER_WASM_DECODE)];
      if (sites.length !== 1) {
        this.error(
          `watershed-rapier-wasm-asset: expected exactly 1 inlined wasm decode site in ${id}, ` +
            `found ${sites.length}. @dimforge/rapier3d-compat changed shape — re-audit this plugin.`,
        );
      }
      const [site, initFn, , base64] = sites[0];
      const bytes = fs.readFileSync(wasmFile);
      if (!Buffer.from(base64, 'base64').equals(bytes)) {
        this.error(
          'watershed-rapier-wasm-asset: the base64 literal in rapier.mjs does not decode to ' +
            `${wasmFile}. Refusing to ship a wasm the package does not contain.`,
        );
      }
      const ref = this.emitFile({ type: 'asset', name: 'rapier_wasm3d_bg.wasm', source: bytes });
      return {
        code: code.replace(site, `yield ${initFn}(import.meta.ROLLUP_FILE_URL_${ref})`),
        map: null,
      };
    },
  };
}

/** `<link rel="preload" as="fetch" crossorigin>` for the Rapier wasm, so the
 *  download starts with the HTML instead of after the entry chunk has run. The
 *  loader's `fetch(url)` is a same-origin CORS-mode request, which is what
 *  `crossorigin` (anonymous) preloads, so the preload is actually consumed. */
function rapierWasmPreloadPlugin(): Plugin {
  return {
    name: 'watershed-rapier-wasm-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const wasm = Object.keys(ctx.bundle ?? {}).find((f) => /^assets\/rapier_wasm3d_bg-[^/]+\.wasm$/.test(f));
        if (!wasm) throw new Error('watershed-rapier-wasm-preload: no rapier_wasm3d_bg-*.wasm in the bundle');
        return [
          {
            tag: 'link',
            attrs: { rel: 'preload', as: 'fetch', type: 'application/wasm', crossorigin: '', href: `./${wasm}` },
            injectTo: 'head',
          },
        ];
      },
    },
  };
}

export default defineConfig({
  define: {
    __WATERSHED_ASSET_BASE__: JSON.stringify('./'),
    __WATERSHED_BUILD_IDENTITY__: JSON.stringify(BUILD_IDENTITY),
  },
  plugins: [
    react(),
    buildIdentityPlugin(BUILD_IDENTITY),
    sourcemapsOutOfBuildPlugin(),
    rapierWasmAssetPlugin(),
    rapierWasmPreloadPlugin(),
  ],
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
  // Both workers are `new Worker(new URL(..), { type: 'module' })`; iife (the
  // default) cannot code-split, es matches what the browser is told to load.
  worker: {
    format: 'es',
    plugins: () => [rapierWasmAssetPlugin()],
  },
  build: {
    outDir: 'build',
    // Explicit floor instead of Vite 7's moving "baseline-widely-available"
    // default (~Chrome 107). es2022 = Chrome 94+, under the WebGL2 path's needs.
    target: 'es2022',
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-three':  ['three', '@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
});
