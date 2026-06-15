import { describe, expect, it } from 'vitest';
import { octantBits, type OctantBitset } from './touch';

// Distinct power-of-two bits so combined diagonals are unambiguous.
const B: OctantBitset = { up: 1, down: 2, left: 4, right: 8 };

describe('octantBits — cardinals (screen y grows downward)', () => {
  it('east → right', () => expect(octantBits(10, 0, 5, B)).toBe(B.right));
  it('south → down', () => expect(octantBits(0, 10, 5, B)).toBe(B.down));
  it('west → left', () => expect(octantBits(-10, 0, 5, B)).toBe(B.left));
  it('north → up', () => expect(octantBits(0, -10, 5, B)).toBe(B.up));
});

describe('octantBits — diagonals combine two bits', () => {
  it('south-east → right|down', () => expect(octantBits(10, 10, 5, B)).toBe(B.right | B.down));
  it('south-west → left|down', () => expect(octantBits(-10, 10, 5, B)).toBe(B.left | B.down));
  it('north-west → left|up', () => expect(octantBits(-10, -10, 5, B)).toBe(B.left | B.up));
  it('north-east → right|up', () => expect(octantBits(10, -10, 5, B)).toBe(B.right | B.up));
});

describe('octantBits — deadzone', () => {
  it('returns 0 strictly inside the deadzone radius', () => {
    expect(octantBits(3, 0, 5, B)).toBe(0);
    expect(octantBits(0, 0, 5, B)).toBe(0);
  });
  it('activates exactly at the deadzone edge', () => {
    expect(octantBits(5, 0, 5, B)).toBe(B.right);
  });
});
