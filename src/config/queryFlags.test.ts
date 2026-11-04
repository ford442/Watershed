import { afterEach, describe, expect, it } from 'vitest';
import { editQuery, parseQueryFlags, queryFlags, queryParam } from './queryFlags';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('queryFlags (#521 E)', () => {
  it('treats ?debug=1 and ?debug=true as the same switch', () => {
    expect(parseQueryFlags('?debug=1').debug).toBe(true);
    expect(parseQueryFlags('debug=true').debug).toBe(true);
    expect(parseQueryFlags('?debug=0').debug).toBe(false);
    expect(parseQueryFlags('?debug=yes').debug).toBe(false);
    expect(parseQueryFlags('').debug).toBe(false);
  });

  it('reads presence flags with or without a value', () => {
    expect(parseQueryFlags('?no-pointer-lock').noPointerLock).toBe(true);
    expect(parseQueryFlags('?no-pointer-lock=1').noPointerLock).toBe(true);
    expect(parseQueryFlags('?no-pointer-lock=0').noPointerLock).toBe(false);
    expect(parseQueryFlags('?map=meander').noPointerLock).toBe(false);
  });

  it('returns a frozen object', () => {
    const flags = parseQueryFlags('?map=delta&vehicle=raft');
    expect(Object.isFrozen(flags)).toBe(true);
    expect(flags.map).toBe('delta');
    expect(flags.vehicle).toBe('raft');
  });

  it('parses the page once per query string: the same object until the URL changes', () => {
    window.history.replaceState(null, '', '/?debug=true&input=script:/a.json');
    const a = queryFlags();
    expect(queryFlags()).toBe(a);
    expect(a.debug).toBe(true);
    expect(a.input).toBe('script:/a.json');
    window.history.replaceState(null, '', '/?debug=1');
    const b = queryFlags();
    expect(b).not.toBe(a);
    expect(b.debug).toBe(true);
    expect(b.input).toBeNull();
  });

  it('editQuery rewrites the URL in place and the next read sees it', () => {
    window.history.replaceState(null, '', '/?map=meander');
    editQuery((p) => p.set('wireframe', '1'));
    expect(queryFlags().wireframe).toBe(true);
    expect(queryParam('map')).toBe('meander');
    editQuery((p) => p.delete('wireframe'));
    expect(queryFlags().wireframe).toBe(false);
  });
});
