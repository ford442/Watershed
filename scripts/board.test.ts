import { describe, expect, it } from 'vitest';
// @ts-expect-error — a plain .mjs build script, no declarations.
import { parseTitle, renderTable, spliceBoard } from './board.mjs';

describe('board.mjs (#574 C)', () => {
  it('strips the model tag and lifts the priority out of a title', () => {
    expect(parseTitle('[Opus 5.5 high] P1 Native: one ABI source')).toEqual({ priority: 'P1', title: 'Native: one ABI source' });
    expect(parseTitle('[Claude Sonnet 5 high] #555 B.1 — TSL parity')).toEqual({ priority: '—', title: '#555 B.1 — TSL parity' });
  });

  it('sorts by priority then number and escapes pipes', () => {
    const table = renderTable([
      { number: 9, title: 'P2 Late', labels: [] },
      { number: 7, title: 'P1 a | b', labels: [{ name: 'epic' }, { name: 'api' }] },
      { number: 3, title: 'P1 Early', labels: [] },
    ]);
    const rows = table.split('\n').filter((l: string) => l.startsWith('| #'));
    expect(rows).toEqual(['| #3 | P1 | Early |  |', '| #7 | P1 | a \\| b | api, epic |', '| #9 | P2 | Late |  |']);
  });

  it('replaces only the generated block, and refuses a board without one', () => {
    const board = 'head\n<!-- board:issues:start -->\nold\n<!-- board:issues:end -->\ntail\n';
    const next = spliceBoard(board, renderTable([]));
    expect(next.startsWith('head\n<!-- board:issues:start -->')).toBe(true);
    expect(next).toContain('_No open issues._');
    expect(next.endsWith('<!-- board:issues:end -->\ntail\n')).toBe(true);
    expect(() => spliceBoard('no markers', renderTable([]))).toThrow(/board:issues:start/);
  });
});
