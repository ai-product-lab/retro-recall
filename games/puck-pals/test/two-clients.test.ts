/**
 * Two-headless-clients gate (netcode SPEC §Testing) for the versus room: drive
 * two real sim+netcode clients and a RoomCore server through a scripted 1v1 —
 * join, skate, one disconnects (→ CPU takes the slot, SPEC §11), then rejoins
 * and reclaims it — over an in-memory network with symmetric delay on a fake
 * clock. The server's periodic hashchecks are verified by each client against
 * its restored snapshots; any mismatch is a determinism bug and fails the test.
 */
import { describe, expect, it } from 'vitest';
import { Button, Rng } from '@retro-recall/retrokit/sim';
import { RoomClient, RoomCore, type Transport } from '@retro-recall/netcode';
import { PuckPalsSim, type GameState } from '../src/sim/sim';

const TICK_MS = 1000 / 60;
const DELAY = 3; // one-way network delay, whole ticks (~50 ms)
const TOTAL = 2000;

class PipeEnd implements Transport {
  onOpen: (() => void) | null = null;
  onMessage: ((data: string) => void) | null = null;
  onClose: (() => void) | null = null;
  dead = false;
  constructor(
    private readonly sendImpl: (data: string) => void,
    private readonly closeImpl: () => void,
  ) {}
  send(data: string): void {
    if (!this.dead) this.sendImpl(data);
  }
  close(): void {
    if (this.dead) return;
    this.dead = true;
    this.closeImpl();
    this.onClose?.();
  }
}

const skater = (st: GameState, id: number) => st.skaters.find((s) => s.id === id)!;

describe('two headless clients vs. the Puck Pals room server', () => {
  it('plays a 1v1 through a disconnect (CPU takeover) and rejoin with zero desyncs', () => {
    let t = 0;
    const queue: { at: number; deliver: () => void }[] = [];
    const post = (delay: number, deliver: () => void): void => {
      queue.push({ at: t + delay, deliver });
    };
    const pump = (): void => {
      for (let i = 0; i < queue.length; i++) {
        if (queue[i]!.at <= t) {
          const p = queue.splice(i, 1)[0]!;
          i--;
          p.deliver();
        }
      }
    };

    const rng = new Rng(0x7e57);
    const clientEnds = new Map<string, PipeEnd>();
    const stats = { a: 0, b: 0 };
    const server = new RoomCore({
      createSim: (seed) => new PuckPalsSim(seed),
      seed: 0xfaceb0b,
      send: (connId, data) => {
        post(DELAY, () => {
          const end = clientEnds.get(connId);
          if (!end || end.dead) return;
          if (data.includes('"hashcheck"')) stats[connId[0] as 'a' | 'b']++;
          end.onMessage?.(data);
        });
      },
      closeConn: (connId) => clientEnds.get(connId)?.close(),
      now: () => t * TICK_MS,
      random: () => rng.next() / 2 ** 32,
    });

    let nextConn = 0;
    const makeConnect = (who: 'a' | 'b') => (): Transport => {
      const connId = `${who}${nextConn++}`;
      const end: PipeEnd = new PipeEnd(
        (data) => post(DELAY, () => server.handleMessage(connId, data)),
        () => post(0, () => server.handleClose(connId)),
      );
      clientEnds.set(connId, end);
      post(DELAY, () => {
        if (!end.dead) end.onOpen?.();
      });
      return end;
    };

    const desyncs: string[] = [];
    const clientA = new RoomClient<PuckPalsSim>({
      connect: makeConnect('a'),
      createSim: () => new PuckPalsSim(0),
      playerName: 'kevin',
      now: () => t * TICK_MS,
      onEvent: (ev) => {
        if (ev.kind === 'desync') desyncs.push(`A@${ev.tick}`);
      },
    });
    const clientB = new RoomClient<PuckPalsSim>({
      connect: makeConnect('b'),
      createSim: () => new PuckPalsSim(0),
      playerName: 'friend',
      now: () => t * TICK_MS,
      onEvent: (ev) => {
        if (ev.kind === 'desync') desyncs.push(`B@${ev.tick}`);
      },
    });

    // Scripted pads: A forechecks up-and-right; B circles down-and-left, both jab.
    const scriptA = (n: number): number => {
      const p = n % 120;
      if (p < 50) return Button.Up | Button.Right;
      if (p < 54) return Button.B;
      if (p < 90) return Button.Down;
      return 0;
    };
    const scriptB = (n: number): number => {
      const p = n % 150;
      if (p < 45) return Button.Down | Button.Left;
      if (p < 49) return Button.B;
      if (p < 80) return Button.Up | Button.A;
      return 0;
    };

    const B_JOIN = 60;
    const B_DROP = 700;
    const B_REJOIN = 1300; // well past the 180-tick CPU-takeover grace
    let awayDuringOutage = '';

    for (t = 0; t < TOTAL; t++) {
      pump();
      if (t === 0) clientA.start();
      if (t === B_JOIN) clientB.start();
      if (t === B_DROP) {
        const bEnd = [...clientEnds.values()].find((e) => !e.dead && e !== clientEnds.get('a0'))!;
        bEnd.close();
      }
      if (t === 1250 && clientA.predicted) {
        awayDuringOutage = skater(clientA.predicted.state, 10).controller; // should be 'cpu'
      }
      if (t === B_REJOIN) clientB.reconnect();
      clientA.localTick(scriptA(t));
      clientB.localTick(scriptB(t));
      server.tickOnce();
    }
    pump();

    // The determinism gate: hashchecks fired and nobody desynced.
    expect(stats.a).toBeGreaterThanOrEqual(3); // ticks 600/1200/1800
    expect(stats.b).toBeGreaterThanOrEqual(1); // at least one after rejoin
    expect(desyncs).toEqual([]);
    expect(clientA.desyncs).toEqual([]);
    expect(clientB.desyncs).toEqual([]);

    // Both clients active in their slots; B reclaimed slot 1 after the rejoin.
    expect(clientA.status).toBe('active');
    expect(clientB.status).toBe('active');
    expect(clientA.slot).toBe(0);
    expect(clientB.slot).toBe(1);

    // Versus disconnect rule (SPEC §11): the away skater went CPU during the
    // outage, and a human again after the rejoin — it never vanished.
    expect(awayDuringOutage).toBe('cpu');
    expect(skater(clientB.predicted!.state, 10).controller).toBe('human');

    // Predictions track the server within the lead window.
    const lead = clientA.predicted!.state.tick - server.tick;
    expect(lead).toBeGreaterThanOrEqual(0);
    expect(lead).toBeLessThanOrEqual(35);

    // Peers agree on who's connected.
    expect(clientA.peers[0]).toMatchObject({ name: 'kevin', connected: true });
    expect(clientA.peers[1]).toMatchObject({ name: 'friend', connected: true });
  });
});
