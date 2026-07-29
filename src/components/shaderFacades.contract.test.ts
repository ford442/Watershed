/**
 * Facade drift guard for `FlowingWater.d.ts` and `EnhancedSky.d.ts`.
 *
 * Those two components stayed as `.jsx` (see the header comment in each `.d.ts`
 * for why), with a hand-written declaration carrying the type contract. Nothing
 * in `tsc` can verify a hand-written `.d.ts` against the JS it describes, so
 * this test closes the loop: it parses the component's actual destructured prop
 * list out of the source and compares it to the prop list declared in the
 * facade. Add a prop to the `.jsx` without declaring it (or vice versa) and this
 * fails.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

function readComponent(file: string): string {
  return readFileSync(join(here, file), 'utf8');
}

/**
 * Extract the prop names a component destructures from its props object.
 * Returns null when the component declares no destructured props at all.
 */
function destructuredProps(source: string, componentName: string): string[] | null {
  const start = source.indexOf(`export default function ${componentName}(`);
  expect(start, `${componentName} default export not found`).toBeGreaterThanOrEqual(0);

  const openParen = source.indexOf('(', start);
  const openBrace = source.indexOf('{', openParen);
  const closeParen = source.indexOf(')', openParen);

  // No destructuring: `function Foo() {` — the `)` comes before any `{`.
  if (openBrace === -1 || closeParen < openBrace) return null;

  // Walk to the matching brace so nested defaults do not truncate the list.
  let depth = 0;
  let end = -1;
  for (let i = openBrace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  expect(end, `could not find end of ${componentName} prop destructuring`).toBeGreaterThan(openBrace);

  return source
    .slice(openBrace + 1, end)
    .split(',')
    // Strip default values, then keep the bare identifier.
    .map((entry) => entry.split('=')[0].trim())
    .filter((name) => name.length > 0 && /^[A-Za-z_$][\w$]*$/.test(name));
}

/** Prop names declared in a facade interface block. */
function declaredProps(source: string, interfaceName: string): string[] {
  const start = source.indexOf(`export interface ${interfaceName} {`);
  expect(start, `${interfaceName} not found in facade`).toBeGreaterThanOrEqual(0);
  const openBrace = source.indexOf('{', start);
  const end = source.indexOf('\n}', openBrace);
  expect(end).toBeGreaterThan(openBrace);

  return source
    .slice(openBrace + 1, end)
    .split('\n')
    .map((line) => line.trim())
    // Property signatures only — skip comments and blank lines.
    .filter((line) => /^[A-Za-z_$][\w$]*\??:/.test(line))
    .map((line) => line.split(/\??:/)[0].trim());
}

describe('FlowingWater typed facade', () => {
  const component = readComponent('FlowingWater.jsx');
  const facade = readComponent('FlowingWater.d.ts');

  it('declares exactly the props the component destructures', () => {
    const actual = destructuredProps(component, 'FlowingWater');
    expect(actual, 'FlowingWater should destructure props').not.toBeNull();
    const declared = declaredProps(facade, 'FlowingWaterProps');

    expect([...declared].sort()).toEqual([...actual!].sort());
  });

  it('marks only `geometry` as required, matching the component defaults', () => {
    // Every prop except `geometry` has a default (or is an optional callback),
    // so the facade must not force call sites to pass them.
    const required = facade
      .slice(facade.indexOf('export interface FlowingWaterProps {'))
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[A-Za-z_$][\w$]*:/.test(line))
      .map((line) => line.split(':')[0].trim());

    expect(required).toEqual(['geometry']);
  });

  it('still exports the reflection-sampling flag the facade declares', async () => {
    const mod = await import('./FlowingWater');
    expect(typeof mod.default).toBe('function');
    expect(typeof mod.FLOWING_WATER_SAMPLES_REFLECTION).toBe('boolean');
  });
});

describe('EnhancedSky typed facade', () => {
  const component = readComponent('EnhancedSky.jsx');

  it('takes no props, matching the Record<string, never> facade', () => {
    expect(destructuredProps(component, 'EnhancedSky')).toBeNull();
  });
});
