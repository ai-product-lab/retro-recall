export const Tile = {
  Empty: 0,
  Solid: 1,
  Platform: 2,
  // --- Slope tiles (ADR-009 / Ramp Riders) ---------------------------------
  // A slope tile is *not* solid: the AABB pass moves through it freely and the
  // slope resolver in physics.ts lifts entities onto its surface. Numbering is
  // contiguous from 3 so `isSlope` is a range check. Each kind's surface is a
  // per-column height table (see slopeColumnHeight). 45° rise a full tile per
  // tile; 22.5° rise a half tile, so a full-height 22.5° ramp pairs a Lo tile
  // with a Hi tile in the next column.
  Slope45R: 3, // `/` — rises to the right (high edge on the right)
  Slope45L: 4, // `\` — rises to the left
  Slope22RLo: 5, // `<` — 22.5° rising right, lower half
  Slope22RHi: 6, // `[` — 22.5° rising right, upper half
  Slope22LHi: 7, // `]` — 22.5° rising left, upper half
  Slope22LLo: 8, // `>` — 22.5° rising left, lower half
} as const;

export type TileKind = (typeof Tile)[keyof typeof Tile];

/** Lowest and highest slope tile values, for fast range checks. */
const SLOPE_MIN = Tile.Slope45R;
const SLOPE_MAX = Tile.Slope22LLo;

/** True for any slope tile kind. */
export function isSlope(t: TileKind): boolean {
  return t >= SLOPE_MIN && t <= SLOPE_MAX;
}

/** Map of ASCII map chars to slope tile kinds (used by parse and by tests). */
export const SLOPE_CHARS: Readonly<Record<string, TileKind>> = {
  '/': Tile.Slope45R,
  '\\': Tile.Slope45L,
  '<': Tile.Slope22RLo,
  '[': Tile.Slope22RHi,
  ']': Tile.Slope22LHi,
  '>': Tile.Slope22LLo,
};

/**
 * Surface height of a slope column, in pixels above the tile's bottom edge, at
 * local x within [0, tileSize). Integer, deterministic, tileSize-agnostic.
 * The resting world-y of an entity standing here is `tileBottomY - height`.
 *
 * 45°  : height climbs 1px per px  → full tile of rise.
 * 22.5°: height climbs 1px per 2px → half a tile of rise; the Hi variant sits
 *        a half-tile higher so a Lo+Hi pair forms one continuous ramp.
 */
export function slopeColumnHeight(kind: TileKind, tileSize: number, localX: number): number {
  const ts = tileSize;
  const half = ts >> 1;
  switch (kind) {
    case Tile.Slope45R:
      return localX + 1; // 1..ts left→right
    case Tile.Slope45L:
      return ts - localX; // ts..1 left→right
    case Tile.Slope22RLo:
      return (localX >> 1) + 1; // 1..half
    case Tile.Slope22RHi:
      return (localX >> 1) + 1 + half; // half+1..ts
    case Tile.Slope22LHi:
      return ((ts - 1 - localX) >> 1) + 1 + half;
    case Tile.Slope22LLo:
      return ((ts - 1 - localX) >> 1) + 1;
    default:
      return 0;
  }
}

export interface SpawnMarker {
  char: string;
  /** Tile coordinates of the marker. */
  tx: number;
  ty: number;
}

/**
 * Immutable tile grid parsed from an ASCII map. Out-of-bounds queries return
 * Solid so entities can never leave the level.
 */
export class TileMap {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  /**
   * True iff the map contains at least one slope tile. The physics core uses
   * this to skip slope resolution entirely on slope-free maps, so every game
   * that predates slopes (Bubble Buddies) keeps a byte-identical code path and
   * its replay fixtures are provably unaffected.
   */
  readonly hasSlopes: boolean;
  private readonly tiles: Uint8Array;

  constructor(width: number, height: number, tileSize: number, tiles: Uint8Array) {
    this.width = width;
    this.height = height;
    this.tileSize = tileSize;
    this.tiles = tiles;
    let slopes = false;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i]! >= SLOPE_MIN && tiles[i]! <= SLOPE_MAX) {
        slopes = true;
        break;
      }
    }
    this.hasSlopes = slopes;
  }

  /**
   * Parse ASCII rows. `#` = solid, `=` = platform, the SLOPE_CHARS map slope
   * tiles; `.` and other characters are empty, and any non-`.` empty character
   * is reported as a spawn marker.
   */
  static parse(rows: readonly string[], tileSize: number): { map: TileMap; spawns: SpawnMarker[] } {
    const height = rows.length;
    const width = rows[0]?.length ?? 0;
    const tiles = new Uint8Array(width * height);
    const spawns: SpawnMarker[] = [];
    for (let ty = 0; ty < height; ty++) {
      const row = rows[ty]!;
      if (row.length !== width) {
        throw new Error(`tilemap row ${ty} has length ${row.length}, expected ${width}`);
      }
      for (let tx = 0; tx < width; tx++) {
        const ch = row[tx]!;
        if (ch === '#') tiles[ty * width + tx] = Tile.Solid;
        else if (ch === '=') tiles[ty * width + tx] = Tile.Platform;
        else if (ch in SLOPE_CHARS) tiles[ty * width + tx] = SLOPE_CHARS[ch]!;
        else if (ch !== '.') spawns.push({ char: ch, tx, ty });
      }
    }
    return { map: new TileMap(width, height, tileSize, tiles), spawns };
  }

  /** Total level width in pixels — the camera's world bound for big maps. */
  get pixelWidth(): number {
    return this.width * this.tileSize;
  }

  /** Total level height in pixels. */
  get pixelHeight(): number {
    return this.height * this.tileSize;
  }

  at(tx: number, ty: number): TileKind {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return Tile.Solid;
    return this.tiles[ty * this.width + tx] as TileKind;
  }

  isSolid(tx: number, ty: number): boolean {
    return this.at(tx, ty) === Tile.Solid;
  }

  isPlatform(tx: number, ty: number): boolean {
    return this.at(tx, ty) === Tile.Platform;
  }

  isSlope(tx: number, ty: number): boolean {
    return isSlope(this.at(tx, ty));
  }

  /**
   * World-y (pixels) of the slope surface at a world-x pixel column, or null if
   * no slope tile covers that column at any row. When a column holds more than
   * one slope tile (unusual), the highest surface wins. This is the query the
   * physics resolver and renderers use to place feet on a ramp.
   */
  slopeSurfaceY(worldPxX: number): number | null {
    const tx = Math.floor(worldPxX / this.tileSize);
    if (tx < 0 || tx >= this.width) return null;
    const localX = worldPxX - tx * this.tileSize;
    let best: number | null = null;
    for (let ty = 0; ty < this.height; ty++) {
      const t = this.at(tx, ty);
      if (!isSlope(t)) continue;
      const tileBottomY = (ty + 1) * this.tileSize;
      const surfaceY = tileBottomY - slopeColumnHeight(t, this.tileSize, localX);
      if (best === null || surfaceY < best) best = surfaceY;
    }
    return best;
  }
}
