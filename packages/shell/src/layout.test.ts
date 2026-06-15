import { describe, expect, it } from 'vitest';
import { controlBand, integerScale } from './layout';

describe('integerScale — pixel-perfect upscale', () => {
  it('picks the largest integer that fits both axes', () => {
    expect(integerScale(512, 384, 256, 192)).toBe(2);
    expect(integerScale(1024, 768, 256, 192)).toBe(4);
  });
  it('is limited by the tighter axis', () => {
    expect(integerScale(1024, 200, 256, 192)).toBe(1); // height-bound
    expect(integerScale(300, 768, 256, 192)).toBe(1); // width-bound
  });
  it('never drops below 1, even when the logical size does not fit', () => {
    expect(integerScale(100, 100, 256, 192)).toBe(1);
    expect(integerScale(0, 0, 256, 192)).toBe(1);
  });
});

describe('controlBand — never collapses below the minimum', () => {
  it('returns the free space when it is in range', () => {
    expect(controlBand(200, 168, 320)).toBe(200);
  });
  it('clamps to the max on tall screens', () => {
    expect(controlBand(500, 168, 320)).toBe(320);
  });
  it('floors to the minimum when the playfield leaves too little (even negative)', () => {
    expect(controlBand(50, 168, 320)).toBe(168);
    expect(controlBand(-40, 168, 320)).toBe(168);
  });
});
