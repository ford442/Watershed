#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const inputs = process.argv.slice(2);
const LEADING_DELIMITERS = /^[(\[<`"']+/g;
const TRAILING_DELIMITERS = /[)\],.;:'"`>]+$/g;

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

const markdownFiles = (inputs.length ? inputs : ['CLAUDE.md', 'SYSTEMS.md'])
  .flatMap(collectMarkdownFiles);

const pattern = /src\/[A-Za-z0-9._/-]+/g;
const failures = [];

function pathExistsAsModule(candidate) {
  if (fs.existsSync(candidate)) return true;

  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.md', '.json'];
  for (const ext of extensions) {
    if (fs.existsSync(`${candidate}${ext}`)) return true;
  }

  return false;
}

for (const file of markdownFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const matches = new Set(content.match(pattern) || []);

  for (const match of matches) {
    const trimmed = match
      .replace(LEADING_DELIMITERS, '')
      .replace(TRAILING_DELIMITERS, '');
    const target = path.resolve(repoRoot, trimmed);
    if (!pathExistsAsModule(target)) {
      failures.push(`${path.relative(repoRoot, file)}: ${trimmed}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Broken markdown paths found:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Validated ${markdownFiles.length} markdown file(s).`);
