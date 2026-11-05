#!/usr/bin/env node
/**
 * deploy-rehearse.mjs — everything the owner's deploy run does, minus the upload.
 *
 *   pnpm deploy:rehearse            # pnpm build
 *   pnpm deploy:rehearse --full     # pnpm build:full (rebuilds the wasm pair; needs the pinned emcc)
 *   pnpm deploy:rehearse --no-clean # keep the existing build/ dir contents going in
 *   pnpm deploy:rehearse --skip-build # steps 2-4 on the build/ already on disk (to test a hand-edit; the summary says SKIPPED)
 *
 * Steps (stops at the first failure, prints a table, exits non-zero):
 *   1 build        pnpm build              (build/ is removed first so a stale file cannot pass)
 *   2 manifest     scripts/check-build-manifest.mjs --budget
 *   3 verify       serve build/ on 127.0.0.1 under /watershed/ and run
 *                  verification/verify_deploy.mjs --url <local>: charset, build-id,
 *                  wasm stamp, asset drift, zip manifest, headless render
 *   4 dry-run      deploy.py --dry-run --offline: the exact upload list, in upload order
 *
 * No network beyond localhost and no token: DEPLOY_TOKEN is removed from every child's
 * environment and DEPLOY_OFFLINE=1 stops deploy.py (also the `--manifest` call inside
 * verify_deploy) from contacting storage.noahcohn.com.
 *
 * The local server stands in for Apache only where verify_deploy looks: DirectoryIndex →
 * index.html and a UTF-8 charset label on text types. It does NOT run public/.htaccess, so
 * cache headers, COOP/COEP stripping and the real vhost stay unproven until
 * `pnpm verify:deploy` is run against the LIVE URL after the upload.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build');
const MOUNT = '/watershed/'; // the live URL's path, so root-relative asset refs fail here too
const DEFAULT_CHROME = '/opt/pw-browsers/chromium';

const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
  console.log('Usage: pnpm deploy:rehearse [--full] [--no-clean] [--skip-build]');
  process.exit(0);
}

const env = { ...process.env, DEPLOY_OFFLINE: '1' };
delete env.DEPLOY_TOKEN;
if (!env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(DEFAULT_CHROME)) {
  env.PUPPETEER_EXECUTABLE_PATH = DEFAULT_CHROME;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wgsl': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
};

function serveBuild() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === MOUNT.slice(0, -1)) {
      res.writeHead(301, { Location: MOUNT });
      res.end();
      return;
    }
    if (!url.pathname.startsWith(MOUNT)) {
      res.writeHead(404).end('outside /watershed/');
      return;
    }
    let rel;
    try {
      rel = decodeURIComponent(url.pathname.slice(MOUNT.length));
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (rel === '' || rel.endsWith('/')) rel += 'index.html'; // DirectoryIndex index.html
    const file = path.resolve(BUILD, rel);
    if (file !== BUILD && !file.startsWith(BUILD + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': body.length,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** Run a child with inherited stdio; resolves to its exit code (never rejects). */
function run(cmd, cmdArgs) {
  console.log(`\n$ ${[cmd, ...cmdArgs].join(' ')}`);
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { cwd: ROOT, env, stdio: 'inherit' });
    child.on('error', (err) => {
      console.error(`could not start ${cmd}: ${err.message}`);
      resolve(127);
    });
    child.on('close', (code, signal) => resolve(code ?? (signal ? 128 : 1)));
  });
}

const results = [];
let skipped = false;
async function step(name, fn) {
  console.log(`\n=== [${results.length + 1}/4] ${name} ===`);
  const code = await fn();
  results.push({ name, code });
  return code === 0;
}

function summary() {
  console.log('\n=== deploy:rehearse summary ===');
  const names = ['build', 'build manifest (--budget)', 'local verify:deploy', 'deploy.py --dry-run'];
  names.forEach((name, i) => {
    const r = results[i];
    const status = r ? (r.code === 0 ? (i === 0 && skipped ? 'SKIPPED' : 'PASS') : `FAIL (exit ${r.code})`) : 'not run';
    console.log(`  ${status.padEnd(14)} ${name}`);
  });
  const failed = results.find((r) => r.code !== 0);
  console.log(
    failed
      ? `\nREHEARSAL FAILED at "${failed.name}". Do not deploy.`
      : '\nREHEARSAL PASSED. Local only: cache headers and the real vhost are proven by `pnpm verify:deploy` against the LIVE URL after the upload.',
  );
  return failed ? 1 : 0;
}

async function main() {
  const buildScript = args.has('--full') ? 'build:full' : 'build';
  const ok =
    (await step(`pnpm ${buildScript}`, () => {
      if (args.has('--skip-build')) {
        console.log('--skip-build: using the build/ already on disk');
        skipped = true;
        return 0;
      }
      if (!args.has('--no-clean')) fs.rmSync(BUILD, { recursive: true, force: true });
      return run('pnpm', ['run', buildScript]);
    })) &&
    (await step('build manifest (--budget)', () => run('node', ['scripts/check-build-manifest.mjs', '--budget']))) &&
    (await step('serve build/ + verify_deploy.mjs', async () => {
      const server = await serveBuild();
      const { port } = server.address();
      const url = `http://127.0.0.1:${port}${MOUNT}`;
      console.log(`serving build/ at ${url}  (PUPPETEER_EXECUTABLE_PATH=${env.PUPPETEER_EXECUTABLE_PATH ?? '(unset)'})`);
      try {
        return await run('node', ['verification/verify_deploy.mjs', '--url', url]);
      } finally {
        server.close();
        server.closeAllConnections?.();
      }
    })) &&
    (await step('deploy.py --dry-run --offline', () => run('python3', ['deploy.py', '--dry-run', '--offline'])));
  void ok;
  process.exit(summary());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
