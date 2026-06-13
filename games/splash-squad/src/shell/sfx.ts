/**
 * SFX observer (view-layer, SPEC §12): diffs consecutive sim states each frame
 * and fires sound events. The sim emits no audio — this watches its public
 * state, so determinism and replays are untouched. Works on both the local sim
 * (solo) and interpolated server snapshots (online); a level change resyncs the
 * baseline so respawns/repopulated entities don't trigger phantom sounds.
 */
import { playSfx } from './audio';
import type { GameState, PlayerPhase } from '../sim/sim';

export class SfxObserver {
  private level = -1;
  private dropletIds = new Set<number>();
  private pickupIds = new Set<number>();
  private robotSoak = new Map<number, number>();
  private windingDown = new Set<number>();
  private phases: (PlayerPhase | null)[] = [];
  private lives = 0;
  private bossHp: number | null = null;
  private bossPresent = false;
  private refillTicks = 0;
  private refillSeen = new Map<number, number>();
  private clearedAnnounced = false;
  private gameoverAnnounced = false;
  private primed = false;

  private snapshot(s: GameState): void {
    this.level = s.level;
    this.dropletIds = new Set(s.droplets.map((d) => d.id));
    this.pickupIds = new Set(s.pickups.map((p) => p.id));
    this.robotSoak = new Map(s.robots.map((r) => [r.id, r.soak]));
    this.windingDown = new Set(s.robots.filter((r) => r.winddown >= 0).map((r) => r.id));
    this.phases = s.players.map((p) => p?.phase ?? null);
    this.lives = s.lives;
    this.bossHp = s.boss ? s.boss.hp : null;
    this.bossPresent = s.boss !== null;
  }

  observe(s: GameState): void {
    // First frame, or a level/restart boundary: resync silently.
    if (!this.primed || s.level !== this.level) {
      this.primed = true;
      this.snapshot(s);
      return;
    }

    // Firing — any brand-new droplet this frame.
    if (s.droplets.some((d) => !this.dropletIds.has(d.id))) playSfx('squirt');

    // Soak hits + robots newly winding down (and a chain if several at once).
    let hits = 0;
    let newlyDown = 0;
    for (const r of s.robots) {
      const prevSoak = this.robotSoak.get(r.id);
      if (prevSoak !== undefined && r.soak > prevSoak) hits++;
      if (r.winddown >= 0 && !this.windingDown.has(r.id)) newlyDown++;
    }
    if (hits > 0 && newlyDown === 0) playSfx('splashHit');
    if (newlyDown >= 2) playSfx('chain');
    else if (newlyDown === 1) playSfx('sputter');

    // Nozzle pickup taken.
    const nowPickups = new Set(s.pickups.map((p) => p.id));
    if ([...this.pickupIds].some((id) => !nowPickups.has(id))) playSfx('pickup');

    // Downing / revives.
    let fired = false;
    s.players.forEach((p, slot) => {
      const was = this.phases[slot];
      if (!p) return;
      if (was === 'alive' && p.phase === 'bubble') {
        playSfx('downed');
        fired = true;
      } else if (was === 'bubble' && p.phase === 'alive') {
        playSfx('revive');
      }
    });
    if (!fired && s.lives < this.lives) playSfx('downed'); // solo death

    // Refill: a soft tick while any tank is filling (throttled).
    const filling = s.players.some((p, slot) => {
      const prev = this.refillSeen.get(slot);
      return p && p.phase === 'alive' && prev !== undefined && p.tank > prev;
    });
    this.refillSeen = new Map(s.players.map((p, slot) => [slot, p ? p.tank : 0]));
    if (filling && this.refillTicks++ % 8 === 0) playSfx('refill');

    // Boss.
    if (s.boss && this.bossHp !== null && s.boss.hp < this.bossHp) playSfx('bossHit');
    if (this.bossPresent && s.boss === null) playSfx('bossDefeat');

    // Round transitions.
    if (s.mode === 'levelclear' && !this.clearedAnnounced) playSfx('clear');
    if (s.mode === 'win') playSfx('win');
    if (s.mode === 'gameover' && !this.gameoverAnnounced) playSfx('gameover');
    this.clearedAnnounced = s.mode === 'levelclear';
    this.gameoverAnnounced = s.mode === 'gameover';

    this.snapshot(s);
  }
}
