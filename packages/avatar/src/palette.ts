/**
 * PALETTE_P1 — the constrained 16-color house palette (BRAND.md "Palette").
 *
 * Derived from the six brand colors, expanded into a sprite-usable ramp:
 * dark/outline tones, a mint ramp, a cyan ramp, a warm coral/skin ramp, a
 * yellow pair, and neutrals. Avatar generation quantizes to exactly this set
 * so every sprite on screen shares one palette automatically (ADR-004).
 *
 * Index 0 is transparent. Indices 1–15 are the opaque colors quantization can
 * choose from. The aesthetic target is "cute pixel creature," not photoreal
 * skin — the warm ramp (coral → light) reads as friendly creature tones, which
 * is exactly the spirit-of (not copy-of) look ADR-004 calls for.
 *
 * NOTE (ADR-009 / worktree bound): BRAND.md names retrokit as PALETTE_P1's
 * canonical home, but retrokit is off-limits in the avatars worktree. It lives
 * here for now; promote to `@retro-recall/retrokit` in a cross-package pass and
 * have this module re-export it. Keep the values byte-identical when you do.
 */

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const opaque = (hex: number): Rgba => ({
  r: (hex >> 16) & 0xff,
  g: (hex >> 8) & 0xff,
  b: hex & 0xff,
  a: 255,
});

/** 16 entries; index 0 is transparent, 1–15 are opaque. Order is stable — it
 *  is part of the sprite-sheet format, so never reorder, only append (and a new
 *  length would be PALETTE_P2). */
export const PALETTE_P1: readonly Rgba[] = [
  { r: 0, g: 0, b: 0, a: 0 }, // 0  transparent
  opaque(0x0f1222), //  1  Midnight — primary outline / darkest
  opaque(0x1e2440), //  2  deep navy shadow
  opaque(0x2ba877), //  3  mint shadow
  opaque(0x3df5a6), //  4  Phosphor — mint accent
  opaque(0xb8ffe0), //  5  mint light
  opaque(0x2a8fb8), //  6  cyan shadow
  opaque(0x4cc9f0), //  7  Bubble — cyan accent
  opaque(0xbdeeff), //  8  cyan light
  opaque(0xc24a4a), //  9  coral shadow / warm dark
  opaque(0xff6b6b), // 10  Cabinet — coral accent
  opaque(0xffb3a0), // 11  warm light (coral/skin highlight)
  opaque(0xe0a93b), // 12  yellow shadow / warm mid
  opaque(0xffd166), // 13  Star — arcade yellow
  opaque(0x8a7e6b), // 14  warm gray mid
  opaque(0xf2efe9), // 15  Paper — off-white highlight
] as const;

/** Hex strings for the renderer (`#rrggbb`); index 0 maps to `null`. */
export const PALETTE_P1_HEX: readonly (string | null)[] = PALETTE_P1.map((c) =>
  c.a === 0 ? null : `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`,
);

/** Below this alpha a source pixel is treated as transparent (index 0). */
export const ALPHA_CUTOFF = 128;
