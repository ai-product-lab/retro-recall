/**
 * Placeholder tile art — original house-style pixel glyphs, one per game.
 *
 * Each glyph is a tiny pixel grid rendered as crisp SVG `<rect>`s (no smoothing,
 * scales by integer device pixels). Original expression only — no trade dress
 * (ADR-005). When a game ships, its real key art replaces the glyph here.
 *
 * Grids are 8×8; `.` = transparent, any other char indexes the per-glyph
 * palette. Colors lean on the BRAND palette plus each game's accent.
 */

interface Glyph {
  /** 8 rows of 8 chars. */
  rows: string[];
  /** char → hex color. */
  palette: Record<string, string>;
}

const GLYPHS: Record<string, Glyph> = {
  // Two stacked bubbles with a highlight — Bubble Buddies.
  bubbles: {
    rows: [
      '..####..',
      '.#hhbb#.',
      '#hbbbbb#',
      '#bbbbbb#',
      '.#bbbb#.',
      '..####..',
      '...##h..',
      '..#bb#..',
    ],
    palette: { '#': '#1a1f38', b: '#4cc9f0', h: '#bfeeff' },
  },
  // A puck with a motion streak — Puck Pals.
  puck: {
    rows: [
      '........',
      '..ssss..',
      '.s#### s',
      '.s####.s',
      '.s####..',
      '..ssss..',
      '.mm.mm..',
      'm..m..m.',
    ],
    palette: { '#': '#1a1f38', s: '#ffd166', m: '#5b6184' },
  },
  // A falling water droplet with a splash — Splash Squad.
  droplet: {
    rows: [
      '...pp...',
      '...pp...',
      '..pppp..',
      '.pphppp.',
      '.pppppp.',
      '..pppp..',
      '........',
      'p.p..p.p',
    ],
    palette: { p: '#3df5a6', h: '#d6fff0' },
  },
  // A BMX wheel cresting a ramp — Ramp Riders.
  wheel: {
    rows: [
      '........',
      '..cccc..',
      '.c#cc#c.',
      '.cc##cc.',
      '.cc##cc.',
      '.c#cc#c.',
      '..cccc..',
      'rrrrrrrr',
    ],
    palette: { '#': '#1a1f38', c: '#ff6b6b', r: '#7a4a2b' },
  },
};

/**
 * Render a glyph to an inline SVG string sized to `px` logical pixels, crisp at
 * any integer scale. Falls back to an empty (transparent) tile for unknown ids.
 */
export function glyphSVG(id: string, px = 64): string {
  const g = GLYPHS[id];
  const n = 8;
  const cell = px / n;
  let rects = '';
  if (g) {
    for (let y = 0; y < n; y++) {
      const row = g.rows[y] ?? '';
      for (let x = 0; x < n; x++) {
        const ch = row[x];
        const color = ch ? g.palette[ch] : undefined;
        if (!color) continue;
        rects += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="${color}"/>`;
      }
    }
  }
  return `<svg viewBox="0 0 ${px} ${px}" width="${px}" height="${px}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}
