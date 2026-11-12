import { describe, expect, it } from 'vitest';
import { historyKeyAction } from './useHistoryInput';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe('historyKeyAction', () => {
  it('maps the platform shortcuts', () => {
    expect(historyKeyAction(key('z', { ctrlKey: true }))).toBe('undo');
    expect(historyKeyAction(key('z', { metaKey: true }))).toBe('undo');
    expect(historyKeyAction(key('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(historyKeyAction(key('y', { ctrlKey: true }))).toBe('redo');
    expect(historyKeyAction(key('z'))).toBeNull();
    expect(historyKeyAction(key('s', { ctrlKey: true }))).toBeNull();
  });
});
