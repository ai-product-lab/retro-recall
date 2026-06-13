/**
 * Rink geometry (SPEC §2, §8). Pure + deterministic — no DOM, no float state.
 * The rink is a plain bordered box: a solid `#` perimeter (boards) filled with
 * `.` (ice). Goal mouths and lines are constants (SPEC §2), not tile gaps, so
 * the puck scores by a position rule while skaters always collide with the wall.
 */
import { TileMap } from '@retro-recall/retrokit/sim';
import * as C from './constants';

/** Build the boards-and-ice tile grid (RINK_W × RINK_H). */
export function buildRink(): TileMap {
  const rows: string[] = [];
  for (let ty = 0; ty < C.RINK_H; ty++) {
    let row = '';
    for (let tx = 0; tx < C.RINK_W; tx++) {
      const border = tx === 0 || tx === C.RINK_W - 1 || ty === 0 || ty === C.RINK_H - 1;
      row += border ? '#' : '.';
    }
    rows.push(row);
  }
  return TileMap.parse(rows, C.TILE_SIZE).map;
}

/** True when Home (team 0) attacks the top net this period (parity, SPEC §8). */
export function homeAttacksUp(period: number): boolean {
  return period % 2 === 0;
}

/** Vertical attack direction for a team this period: -1 = toward the top net. */
export function attackDirY(team: number, period: number): -1 | 1 {
  const homeUp = homeAttacksUp(period);
  const up = team === 0 ? homeUp : !homeUp;
  return up ? -1 : 1;
}

/** The team scoring in the top net is the one attacking up; bottom net, down. */
export function teamScoringInTopNet(period: number): number {
  return attackDirY(0, period) === -1 ? 0 : 1;
}
