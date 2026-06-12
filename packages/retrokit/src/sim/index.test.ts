import { describe, expect, it } from 'vitest';
import { RETROKIT_VERSION, TICKS_PER_SECOND } from './index.js';

describe('retrokit scaffold', () => {
  it('exports the fixed tick rate', () => {
    expect(TICKS_PER_SECOND).toBe(60);
    expect(RETROKIT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
