import { describe, expect, it } from 'vitest';
// @ts-expect-error — a plain .mjs build script, no declarations.
import { staleReason } from './check-install-fresh.mjs';

const lock = (zundo: string, extra = '') => [
  "lockfileVersion: '9.0'",
  '',
  'importers:',
  '',
  '  .:',
  '    dependencies:',
  '      zundo:',
  `        specifier: ^${zundo}`,
  `        version: ${zundo}`,
  '',
  'packages:',
  '',
  `  zundo@${zundo}:`,
  '    resolution: {integrity: sha512-x}',
  extra,
  '',
].join('\n');

describe('check-install-fresh', () => {
  it('passes an install made from this lockfile', () => {
    expect(staleReason(lock('2.3.0'), lock('2.3.0'))).toBeNull();
  });

  it('passes a pnpm-side reformat that resolves the same tree', () => {
    expect(staleReason(lock('2.3.0'), lock('2.3.0', '    engines: {node: ">=18"}'))).toBeNull();
  });

  it('fails a node_modules installed from an older lockfile, and a missing one', () => {
    expect(staleReason(lock('2.3.0'), lock('2.2.0'))).toMatch(/different pnpm-lock/);
    expect(staleReason(lock('2.3.0'), null)).toMatch(/missing/);
  });
});
