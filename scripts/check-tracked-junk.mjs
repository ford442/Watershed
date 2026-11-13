#!/usr/bin/env node
/**
 * Typecheck guard (#559 A.1): no tool droppings in the index.
 *
 * Fails when `git ls-files` lists
 *   - any file under a tool directory (at any depth): .playwright-mcp (console logs and
 *     page snapshots), .idea (JetBrains project files), .Jules (agent notes), .aider*
 *     (aider history), .claude/worktrees (local agent worktrees); or
 *   - any `*.log` file.
 * Those directories are in .gitignore, but an ignore rule does not untrack what was
 * already committed, and `git add -f` or a stale index defeats it; this makes it a
 * red check. Remedy: `git rm -r --cached <path>` (keeps the files on disk).
 *
 * Outside a git checkout (a source tarball) there is no index to check: the guard
 * says so and passes.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A path segment that marks a tool directory. */
const TOOL_DIR = /^(?:\.playwright-mcp|\.idea|\.Jules|\.aider.*)$/;

/** @returns {string | null} why `file` (a posix path from `git ls-files`) is junk, or null. */
export function junkReason(file) {
  const parts = file.split('/');
  const dirs = parts.slice(0, -1);
  const hit = dirs.find((segment) => TOOL_DIR.test(segment));
  if (hit) return `under tool directory ${hit}/`;
  for (let i = 0; i + 1 < dirs.length; i += 1) {
    if (dirs[i] === '.claude' && dirs[i + 1] === 'worktrees') return 'under tool directory .claude/worktrees/';
  }
  if (/\.log$/i.test(parts[parts.length - 1])) return 'a *.log file';
  return null;
}

function trackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return out.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = trackedFiles();
  if (!files) {
    console.log('[tracked-junk] not a git checkout; nothing to check.');
    process.exit(0);
  }
  const bad = files.map((file) => [file, junkReason(file)]).filter(([, why]) => why);
  if (bad.length) {
    console.error(`[tracked-junk] ${bad.length} tracked file(s) that are tool droppings (#559 A.1):`);
    for (const [file, why] of bad.slice(0, 20)) console.error(`  ${file}  (${why})`);
    if (bad.length > 20) console.error(`  … and ${bad.length - 20} more`);
    console.error('  Untrack them (the files stay on disk): git rm -r --cached <path>; the directories are in .gitignore.');
    process.exit(1);
  }
  console.log(`[tracked-junk] ok: ${files.length} tracked files, none under a tool directory or *.log.`);
}
