import { describe, expect, it, vi } from 'vitest';

// Every error excused as debt: the document still did not validate, so there is
// no LevelData to return.
vi.mock('./levelSchemaDebt', () => ({ filterUnexpectedLevelErrors: () => [] }));

import { assertLevelData } from './assertLevelData';

describe('assertLevelData — debt-excused failure', () => {
  it('throws instead of returning an unvalidated document', () => {
    expect(() => assertLevelData({ metadata: {} }, 'excused')).toThrow(/did not validate/);
  });
});
