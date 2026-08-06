/**
 * Facade drift guard for typed frame-hot components.
 *
 * Parses destructured prop lists from TSX sources and compares them to exported
 * prop interfaces. Prevents silent shape drift on the render hot path.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

function readComponent(file: string): string {
  return readFileSync(join(here, file), 'utf8');
}

function destructuredProps(source: string, componentName: string): string[] | null {
  const start = source.indexOf(`export default function ${componentName}(`);
  expect(start, `${componentName} default export not found`).toBeGreaterThanOrEqual(0);

  const openParen = source.indexOf('(', start);
  const openBrace = source.indexOf('{', openParen);
  const closeParen = source.indexOf(')', openParen);

  if (openBrace === -1 || closeParen < openBrace) return null;

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
    .map((entry) => entry.split('=')[0].trim())
    .filter((name) => name.length > 0 && /^[A-Za-z_$][\w$]*$/.test(name));
}

function declaredProps(source: string, interfaceName: string): string[] {
  const start = source.indexOf(`export interface ${interfaceName} {`);
  expect(start, `${interfaceName} not found in component`).toBeGreaterThanOrEqual(0);
  const openBrace = source.indexOf('{', start);
  const end = source.indexOf('\n}', openBrace);
  expect(end).toBeGreaterThan(openBrace);

  return source
    .slice(openBrace + 1, end)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z_$][\w$]*\??:/.test(line))
    .map((line) => line.split(/\??:/)[0].trim());
}

describe('FlowingWater typed component', () => {
  const component = readComponent('FlowingWater.tsx');

  it('declares exactly the props the component destructures', () => {
    const actual = destructuredProps(component, 'FlowingWater');
    expect(actual, 'FlowingWater should destructure props').not.toBeNull();
    const declared = declaredProps(component, 'FlowingWaterProps');

    expect([...declared].sort()).toEqual([...actual!].sort());
  });

  it('still exports the reflection-sampling flag', async () => {
    const mod = await import('./FlowingWater');
    expect(typeof mod.default).toBe('function');
    expect(typeof mod.FLOWING_WATER_SAMPLES_REFLECTION).toBe('boolean');
  });
});

describe('EnhancedSky typed component', () => {
  const component = readComponent('EnhancedSky.tsx');

  it('takes no props', () => {
    expect(destructuredProps(component, 'EnhancedSky')).toBeNull();
  });
});
