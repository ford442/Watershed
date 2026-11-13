import { describe, expect, it } from 'vitest';
// @ts-expect-error — a plain .mjs build script, no declarations.
import { convertCss } from './px-to-rem.mjs';

describe('px-to-rem (#558 B.1)', () => {
  it('converts type and spacing, keeps hairlines, borders, shadows and breakpoints', () => {
    const src = [
      '.a {',
      '  font-size: 14px;',
      '  padding: 8px 12px;',
      '  gap: 2px;',
      '  border: 1px solid #fff;',
      '  box-shadow: 0 8px 24px #000;',
      '}',
      '@media (max-width: 768px) {',
      '  .b { margin: 24px; }',
      '}',
    ].join('\n');
    const [out, count] = convertCss(src);
    expect(out).toContain('font-size: 0.875rem;');
    expect(out).toContain('padding: 0.5rem 0.75rem;');
    expect(out).toContain('gap: 2px;');
    expect(out).toContain('border: 1px solid #fff;');
    expect(out).toContain('box-shadow: 0 8px 24px #000;');
    expect(out).toContain('@media (max-width: 768px) {');
    expect(out).toContain('.b { margin: 1.5rem; }');
    expect(count).toBe(4);
  });
});
