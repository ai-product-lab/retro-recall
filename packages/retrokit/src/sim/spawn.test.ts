import { describe, expect, it } from 'vitest';
import { SpawnRegions } from './spawn';

const REGIONS = [
  { id: 10, trigger: 256 },
  { id: 20, trigger: 512 },
  { id: 30, trigger: 1024 },
];

describe('SpawnRegions', () => {
  it('fires each region once as progress crosses its trigger', () => {
    const s = new SpawnRegions(REGIONS);
    expect(s.advance(0)).toEqual([]);
    expect(s.advance(255)).toEqual([]);
    expect(s.advance(256)).toEqual([10]); // exactly on the trigger fires
    expect(s.advance(300)).toEqual([]); // no new region
    expect(s.advance(512)).toEqual([20]);
  });

  it('fires every region crossed in a single large jump, in order', () => {
    const s = new SpawnRegions(REGIONS);
    expect(s.advance(2000)).toEqual([10, 20, 30]);
    expect(s.exhausted).toBe(true);
  });

  it('never re-fires when progress retreats then re-advances (high-water mark)', () => {
    const s = new SpawnRegions(REGIONS);
    expect(s.advance(600)).toEqual([10, 20]);
    expect(s.advance(100)).toEqual([]); // camera briefly retreats — nothing
    expect(s.advance(700)).toEqual([]); // back below the high-water of 600
    expect(s.advance(1024)).toEqual([30]);
  });

  it('sorts unordered regions by trigger', () => {
    const s = new SpawnRegions([
      { id: 30, trigger: 1024 },
      { id: 10, trigger: 256 },
      { id: 20, trigger: 512 },
    ]);
    expect(s.advance(1024)).toEqual([10, 20, 30]);
  });

  it('round-trips latch state for netcode snapshots', () => {
    const a = new SpawnRegions(REGIONS);
    a.advance(512); // fires 10, 20
    const b = new SpawnRegions(REGIONS);
    b.restore(a.state());
    // b resumes exactly where a left off — only region 30 remains.
    expect(b.advance(1024)).toEqual([30]);
    expect(a.advance(1024)).toEqual([30]);
  });
});
