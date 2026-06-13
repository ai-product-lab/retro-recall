/**
 * Two-headless-clients gate (netcode SPEC §Testing): drive two real
 * sim+netcode clients and a RoomCore server through a scripted session —
 * join, play, one disconnects, despawns, rejoins — over an in-memory
 * network with symmetric delay, all on a fake clock. The server's periodic
 * hashchecks are verified by each client against its restored snapshots;
 * any mismatch is a determinism bug and fails the test.
 */
import { describe, expect, it } from 'vitest';
import { Button, Rng } from '@retro-recall/retrokit/sim';
import { RoomClient, RoomCore, type Transport } from '@retro-recall/netcode';
import { BubbleBuddiesSim } from '../src/sim/sim';

const TICK_MS = 1000 / 60;
/** One-way network delay, in whole ticks (≈50 ms). */
const DELAY = 3;
const TOTAL = 2000;

interface Packet {
  at: number;
  deliver: () => void;
}

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

describe('two headless clients vs. the room server', () => {
  it('play through joins, a disconnect+despawn, and a rejoin with zero desyncs', () => {
    let t = 0;
    const queue: Packet[] = [];
    const post = (delay: number, deliver: () => void): void => {
      queue.push({ at: t + delay, deliver });
    };
    const pump = (): void => {
      // FIFO among due packets keeps per-connection ordering (like TCP).
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
    // Count hashchecks delivered per client (the gate must actually fire).
    const stats = { a: 0, b: 0 };
    const server = new RoomCore({
      createSim: (seed) => new BubbleBuddiesSim(seed, 0, 0),
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

    // Count input messages each client puts on the wire — the burn fix means
    // a held button must NOT stream one per tick (see HANDOFF-ws-input-burn).
    const inputs = { a: 0, b: 0 };
    let nextConn = 0;
    const makeConnect = (who: 'a' | 'b') => (): Transport => {
      const connId = `${who}${nextConn++}`;
      const end: PipeEnd = new PipeEnd(
        (data) => {
          if (data.includes('"type":"input"')) inputs[who]++;
          post(DELAY, () => server.handleMessage(connId, data));
        },
        () => post(0, () => server.handleClose(connId)),
      );
      clientEnds.set(connId, end);
      post(DELAY, () => {
        if (!end.dead) end.onOpen?.();
      });
      return end;
    };

    const events: string[] = [];
    const clientA = new RoomClient<BubbleBuddiesSim>({
      connect: makeConnect('a'),
      createSim: () => new BubbleBuddiesSim(0, 0, 0),
      playerName: 'kevin',
      now: () => t * TICK_MS,
      onEvent: (ev) => {
        if (ev.kind === 'desync') events.push(`A desync@${ev.tick}`);
      },
    });
    const clientB = new RoomClient<BubbleBuddiesSim>({
      connect: makeConnect('b'),
      createSim: () => new BubbleBuddiesSim(0, 0, 0),
      playerName: 'friend',
      now: () => t * TICK_MS,
      onEvent: (ev) => {
        if (ev.kind === 'desync') events.push(`B desync@${ev.tick}`);
      },
    });

    // Scripted pads: A roams right and blows; B hops left.
    const scriptA = (n: number): number => {
      const phase = n % 120;
      if (phase < 50) return Button.Right;
      if (phase < 52) return Button.B;
      if (phase < 80) return Button.Left | Button.A;
      return 0;
    };
    const scriptB = (n: number): number => {
      const phase = n % 150;
      if (phase < 40) return Button.Left;
      if (phase < 42) return Button.B;
      if (phase < 70) return Button.Right | Button.A;
      return 0;
    };

    const B_JOIN = 60;
    const B_DROP = 700; // hard disconnect (no close frame reaches nobody — but pipe posts close)
    const B_REJOIN = 1300; // well past the 300-tick despawn grace

    let bEnd: PipeEnd | null = null;
    for (t = 0; t < TOTAL; t++) {
      pump();
      if (t === 0) clientA.start();
      if (t === B_JOIN) clientB.start();
      if (t === B_DROP) {
        // Capture B's live transport and sever it.
        bEnd = [...clientEnds.values()].find((e) => !e.dead && e !== clientEnds.get('a0'))!;
        bEnd.close();
      }
      if (t === B_REJOIN) clientB.reconnect();
      clientA.localTick(scriptA(t));
      clientB.localTick(scriptB(t));
      server.tickOnce();
    }
    pump();

    // The determinism gate: hashchecks fired and nobody desynced.
    expect(stats.a).toBeGreaterThanOrEqual(3); // ticks 600/1200/1800
    expect(stats.b).toBeGreaterThanOrEqual(1); // at least post-rejoin
    expect(clientA.desyncs).toEqual([]);
    expect(clientB.desyncs).toEqual([]);
    expect(events).toEqual([]);

    // Burn gate: send-on-change keeps inputs far below one-per-tick. A streamed
    // ~TOTAL messages before the fix; now it's a small multiple of its changes.
    expect(inputs.a).toBeGreaterThan(0);
    expect(inputs.a).toBeLessThan(TOTAL / 4);
    expect(inputs.b).toBeLessThan(TOTAL / 4);

    // Both clients are active in their slots; B reclaimed slot 1 after rejoin.
    expect(clientA.status).toBe('active');
    expect(clientB.status).toBe('active');
    expect(clientA.slot).toBe(0);
    expect(clientB.slot).toBe(1);

    // B despawned during the outage and is alive again after the rejoin.
    const bState = clientB.predicted!.state;
    expect(bState.players[1]!.phase).toBe('alive');

    // Predictions track the server: client display tick = server tick ± lead.
    const lead = clientA.predicted!.state.tick - server.tick;
    expect(lead).toBeGreaterThanOrEqual(0);
    expect(lead).toBeLessThanOrEqual(35);

    // Peers agree on who's connected.
    const aPeers = clientA.peers;
    expect(aPeers[0]).toMatchObject({ name: 'kevin', connected: true });
    expect(aPeers[1]).toMatchObject({ name: 'friend', connected: true });
  });
});
