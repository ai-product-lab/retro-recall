import { describe, expect, it } from 'vitest';
import { GAME_ID, SIM_TICK_RATE } from './index.js';

describe('bubble-buddies scaffold', () => {
  it('wires the workspace dependency on retrokit', () => {
    expect(GAME_ID).toBe('bubble-buddies');
    expect(SIM_TICK_RATE).toBe(60);
  });
});
