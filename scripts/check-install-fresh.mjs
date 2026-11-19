#!/usr/bin/env node
/**
 * check-install-fresh.mjs — fail early, and say why, when node_modules is older
 * than pnpm-lock.yaml.
 *
 * After a lockfile change (a new dependency such as zundo) a checkout whose
 * node_modules predates it fails `pnpm typecheck` and a handful of tests with
 * "Cannot find module …", which reads like a code bug. pnpm records the lockfile
 * it last installed from in node_modules/.pnpm/lock.yaml; when that differs from
 * the committed pnpm-lock.yaml, nothing downstream is worth running.
 *
 * Runs at the head of `pnpm typecheck` and `pnpm test`. Compares the two files
 * byte for byte (the normal case after `pnpm install`), and on a difference
 * falls back to what decides the tree — each importer's resolved versions and
 * the set of package keys — so a pnpm-side reformat alone never fails it.
 *
 * WATERSHED_SKIP_INSTALL_CHECK=1 skips it (e.g. a deliberately partial install).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMITTED = path.join(ROOT, 'pnpm-lock.yaml');
const INSTALLED = path.join(ROOT, 'node_modules', '.pnpm', 'lock.yaml');

/** The lines of one top-level YAML section (`importers:`, `packages:`), without the header. */
export function section(text, name) {
  const lines = text.split('\n');
  const start = lines.indexOf(`${name}:`);
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 0 && !line.startsWith(' ')) break;
    if (line.trim().length > 0) out.push(line);
  }
  return out;
}

/** What decides the installed tree: importer specifiers + versions, and the package keys. */
export function fingerprint(text) {
  const importers = section(text, 'importers').join('\n');
  const packages = section(text, 'packages')
    .filter((l) => /^ {2}\S/.test(l))
    .map((l) => l.trim())
    .sort()
    .join('\n');
  return `${importers}\n--\n${packages}`;
}

/** null when fresh, else the reason. */
export function staleReason(committed, installed) {
  if (installed === null) return 'node_modules/.pnpm/lock.yaml is missing (no pnpm install yet?)';
  if (committed === installed) return null;
  if (fingerprint(committed) === fingerprint(installed)) return null;
  return 'node_modules was installed from a different pnpm-lock.yaml';
}

function main() {
  if (process.env.WATERSHED_SKIP_INSTALL_CHECK === '1') return;
  const committed = fs.readFileSync(COMMITTED, 'utf8');
  const installed = fs.existsSync(INSTALLED) ? fs.readFileSync(INSTALLED, 'utf8') : null;
  const reason = staleReason(committed, installed);
  if (reason === null) return;
  console.error(`\n✗ ${reason}.\n  Run \`pnpm install\` and try again.`);
  console.error('  (WATERSHED_SKIP_INSTALL_CHECK=1 skips this check.)\n');
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
