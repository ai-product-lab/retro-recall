export const Tile = {
  Empty: 0,
  Solid: 1,
  Platform: 2,
} as const;

export type TileKind = (typeof Tile)[keyof typeof Tile];

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
  private readonly tiles: Uint8Array;

  constructor(width: number, height: number, tileSize: number, tiles: Uint8Array) {
    this.width = width;
    this.height = height;
    this.tileSize = tileSize;
    this.tiles = tiles;
  }

  /**
   * Parse ASCII rows. `#` = solid, `=` = platform, everything else = empty;
   * non-`.` empty characters are reported as spawn markers.
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
        else if (ch !== '.') spawns.push({ char: ch, tx, ty });
      }
    }
    return { map: new TileMap(width, height, tileSize, tiles), spawns };
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
}
