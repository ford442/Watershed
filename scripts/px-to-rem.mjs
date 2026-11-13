#!/usr/bin/env node
/**
 * px-to-rem.mjs — the UI type and spacing in rem, so `--ui-scale` and browser
 * zoom / OS text size reach them (#558 B.1).
 *
 *   node scripts/px-to-rem.mjs            rewrite src/style.css + src/styles/*.css
 *   node scripts/px-to-rem.mjs --check    exit 1 if a convertible px length is left
 *
 * What converts: every `Npx` (N > 2) in a declaration value, at 16px = 1rem.
 * What stays px, on purpose:
 *   - hairlines (0–2px): a 1px border must stay one device line at any scale;
 *   - borders, outlines, shadows, filters and transforms: decoration and motion,
 *     not type or spacing (a 200 % UI does not need a 2× blur);
 *   - `@media` / `@container` preludes: there `rem` is the browser's initial
 *     size, not the root's, so a px breakpoint already means what it says;
 *   - the touch layer (`touch-controls.css`): its geometry is sized to a thumb
 *     and the viewport (`vw`, safe-area), not to the text;
 *   - a line ending in the `px-ok` comment marker.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  'src/style.css',
  ...fs
    .readdirSync(path.join(ROOT, 'src/styles'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => `src/styles/${f}`),
];
const SKIP_FILES = new Set(['src/styles/touch-controls.css']);
const KEEP_PROPS =
  /^\s*(?:border(?:-[a-z]+)*|outline(?:-[a-z]+)*|box-shadow|text-shadow|filter|backdrop-filter|-webkit-backdrop-filter|transform|translate|-webkit-text-stroke(?:-width)?|perspective|stroke-width)\s*:/;
const PX = /(-?\d*\.?\d+)px\b/g;

function rem(px) {
  const v = Math.round((px / 16) * 10000) / 10000;
  return `${v}rem`;
}

/** Convert one CSS source. Returns [next, count]. */
export function convertCss(src) {
  let count = 0;
  const lines = src.split('\n');
  const out = lines.map((line) => {
    if (/@media|@container|@supports/.test(line)) return line;
    if (line.includes('px-ok')) return line;
    if (KEEP_PROPS.test(line)) return line;
    // Only declaration values (after the first ':'); selectors carry no px.
    const colon = line.indexOf(':');
    if (colon < 0) return line;
    const head = line.slice(0, colon + 1);
    const value = line.slice(colon + 1);
    const next = value.replace(PX, (m, n) => {
      const px = Number(n);
      if (!Number.isFinite(px) || Math.abs(px) <= 2) return m;
      count += 1;
      return rem(px);
    });
    return head + next;
  });
  return [out.join('\n'), count];
}

function main() {
  const check = process.argv.includes('--check');
  let total = 0;
  for (const rel of FILES) {
    if (SKIP_FILES.has(rel)) continue;
    const abs = path.join(ROOT, rel);
    const src = fs.readFileSync(abs, 'utf8');
    const [next, count] = convertCss(src);
    if (count === 0) continue;
    total += count;
    if (check) {
      console.error(`${rel}: ${count} px length(s) should be rem (node scripts/px-to-rem.mjs)`);
    } else {
      fs.writeFileSync(abs, next);
      console.log(`${rel}: ${count} → rem`);
    }
  }
  if (check && total > 0) process.exit(1);
  if (!check) console.log(`${total} length(s) converted`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
