/**
 * Camera-triggered spawn regions (Splash Squad: "enemies activate as the
 * screen reaches them"; ADR-009 shared engine need).
 *
 * Determinism note — this is the whole reason it lives in the sim and not the
 * renderer: a render Camera is *per-client* (each player follows their own
 * view), so triggering off a Camera would make clients spawn different enemies
 * and desync. Instead the sim owns a monotonic **progress scalar** — typically
 * the authoritative co-op scroll front (world-x), or scroll-y for a vertical
 * level — and feeds it here. The latch is serializable so netcode snapshots
 * and replay fixtures reproduce exactly.
 */

/** A region that fires once when progress first reaches its trigger value. */
export interface SpawnRegion {
  /** Stable id the game maps back to what to spawn (enemy wave, checkpoint…). */
  id: number;
  /** Progress value at which this region activates (e.g. world-x in pixels). */
  trigger: number;
}

interface SpawnRegionsState {
  cursor: number;
  highWater: number;
}

/**
 * Latching tracker over a set of spawn regions. Feed it the sim's monotonic
 * progress each tick; it returns the ids of regions newly crossed, each at most
 * once. Robust to a non-monotonic feed (it tracks a high-water mark), so a
 * camera that briefly retreats never re-fires a region.
 */
export class SpawnRegions {
  private readonly regions: readonly SpawnRegion[];
  private cursor = 0;
  /** Highest progress seen; -1 sentinel sits below any world coordinate. */
  private highWater = -1;

  constructor(regions: readonly SpawnRegion[]) {
    // Sort by trigger so the cursor advances in firing order. Copy first — the
    // caller's array is not mutated.
    this.regions = [...regions].sort((a, b) => a.trigger - b.trigger);
  }

  /**
   * Advance to `progress` and return the ids of every region that activated as
   * a result, in trigger order. Returns [] when nothing new fired.
   */
  advance(progress: number): number[] {
    if (progress > this.highWater) this.highWater = progress;
    const fired: number[] = [];
    while (this.cursor < this.regions.length && this.regions[this.cursor]!.trigger <= this.highWater) {
      fired.push(this.regions[this.cursor]!.id);
      this.cursor++;
    }
    return fired;
  }

  /** True once every region has fired. */
  get exhausted(): boolean {
    return this.cursor >= this.regions.length;
  }

  /** Serializable latch state (cursor + high-water) for netcode snapshots. */
  state(): SpawnRegionsState {
    return { cursor: this.cursor, highWater: this.highWater };
  }

  /** Restore from a previous state() (regions themselves are level-constant). */
  restore(state: SpawnRegionsState): void {
    this.cursor = state.cursor;
    this.highWater = state.highWater;
  }
}
