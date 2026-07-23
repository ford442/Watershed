#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const inputs = process.argv.slice(2);
const LEADING_DELIMITERS = /^[(\[<`"']+/g;
const TRAILING_DELIMITERS = /[)\],.;:'"`>]+$/g;

const DEFAULT_INPUTS = [
  'AGENTS.md',
  'CLAUDE.md',
  'SYSTEMS.md',
  'docs/README.md',
  'docs/reference',
];

const PATH_PATTERNS = [
  /src\/[A-Za-z0-9._/-]+/g,
  /docs\/(?:reference|archive)\/[A-Za-z0-9._/-]+/g,
];

/**
 * Stale stems that must not appear in living markdown (archive/ is excluded).
 * These files were renamed or deleted; citing them recreates agent churn.
 */
const BANNED_PATH_SUBSTRINGS = [
  'Experience.jsx',
  'TrackManager.jsx',
  'TrackSegment.jsx',
  'Player.jsx',
  'Player.tsx',
  'PostProcessingEffects.jsx',
  'PostProcessingEffects.tsx',
  'RiverTrack.jsx',
  'CreekCanyon.jsx',
  'Raft.jsx',
  'WaterForces.jsx',
  'WaterFlowForce.jsx',
  'webgpu-react-app',
];

function collectMarkdownFiles(entry) {
  const fullPath = path.resolve(repoRoot, entry);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Input path does not exist: ${entry} (resolved to ${fullPath})`);
  }

  const stat = fs.statSync(fullPath);
  if (stat.isFile()) {
    return fullPath.endsWith('.md') ? [fullPath] : [];
  }

  const results = [];
  for (const child of fs.readdirSync(fullPath)) {
    if (child === '.git' || child === 'node_modules' || child === 'build') continue;
    results.push(...collectMarkdownFiles(path.join(entry, child)));
  }
  return results;
}

const markdownFiles = (inputs.length ? inputs : DEFAULT_INPUTS)
  .flatMap(collectMarkdownFiles);

const failures = [];

function pathExistsAsModule(candidate) {
  if (fs.existsSync(candidate)) return true;

  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.md', '.json'];
  for (const ext of extensions) {
    if (fs.existsSync(`${candidate}${ext}`)) return true;
  }

  if (fs.existsSync(path.join(candidate, 'index.ts'))
    || fs.existsSync(path.join(candidate, 'index.tsx'))
    || fs.existsSync(path.join(candidate, 'index.js'))
    || fs.existsSync(path.join(candidate, 'index.jsx'))) {
    return true;
  }

  return false;
}

function stripNonProse(content) {
  let result = content.replace(/```[\s\S]*?```/g, '');
  result = result.replace(/https?:\/\/\S+/g, '');
  result = result.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  return result;
}

for (const file of markdownFiles) {
  const relative = path.relative(repoRoot, file);
  const raw = fs.readFileSync(file, 'utf8');
  const content = stripNonProse(raw);
  const matches = new Set();

  for (const pattern of PATH_PATTERNS) {
    for (const match of content.match(pattern) || []) {
      matches.add(match);
    }
  }

  for (const match of matches) {
    const trimmed = match
      .replace(LEADING_DELIMITERS, '')
      .replace(TRAILING_DELIMITERS, '');
    const target = path.resolve(repoRoot, trimmed);
    if (!pathExistsAsModule(target)) {
      failures.push(`${relative}: missing path ${trimmed}`);
    }
  }

  // Banned stale stems — scan full file (including code fences) so examples stay honest.
  for (const banned of BANNED_PATH_SUBSTRINGS) {
    if (raw.includes(banned)) {
      failures.push(`${relative}: banned stale reference "${banned}"`);
    }
  }
}

if (failures.length > 0) {
  console.error('Broken / banned markdown paths found:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Validated ${markdownFiles.length} markdown file(s).`);
