/**
 * FNV-1a 32-bit over a string. Used to hash serialized sim state; the netcode
 * sync check and the replay regression tests both compare these values, so
 * the algorithm must never change once fixtures exist.
 */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
