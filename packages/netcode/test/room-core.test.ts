import { describe, expect, it } from 'vitest';
import { Rng, fnv1a } from '@retro-recall/retrokit/sim';
import {
  EMOTE_RATE_TICKS,
  HASHCHECK_EVERY,
  REJOIN_WINDOW_S,
  SNAPSHOT_EVERY,
  isRoomCode,
  makeRoomCode,
} from '../src/protocol';
import { RoomCore, type NetSim } from '../src/room/core';

/**
 * Minimal deterministic sim standing in for a game: records joins and the
 * exact input arrays fed to each tick, so tests can assert what the room
 * delivered. Mode flips to 'levelclear' at tick 50 (for levelEvent tests).
 */
class TestSim implements NetSim {
  state: {
    tick: number;
    mode: string;
    joined: number[];
    rejoined: number[];
    received: (number | null)[][];
  } = { tick: 0, mode: 'playing', joined: [], rejoined: [], received: [] };

  tick(inputs: readonly (number | null)[]): void {
    this.state.received.push([...inputs]);
    this.state.tick++;
    this.state.mode = this.state.tick === 50 ? 'levelclear' : 'playing';
  }

  serialize(): string {
    return JSON.stringify(this.state);
  }

  hash(): number {
    return fnv1a(this.serialize());
  }

  snapshot(): string {
    return this.serialize();
  }

  restore(json: string): void {
    this.state = JSON.parse(json) as TestSim['state'];
  }

  joinPlayer(slot: number): void {
    this.state.joined.push(slot);
  }

  rejoinPlayer(slot: number): void {
    this.state.rejoined.push(slot);
  }
}

interface Harness {
  room: RoomCore;
  sim: () => TestSim;
  sent: Map<string, unknown[]>;
  closed: string[];
  clock: { ms: number };
  join: (connId: string, name?: string, token?: string) => void;
  last: (connId: string, type: string) => Record<string, unknown> | undefined;
  all: (connId: string, type: string) => Record<string, unknown>[];
}

const harness = (): Harness => {
  const sent = new Map<string, unknown[]>();
  const closed: string[] = [];
  const clock = { ms: 0 };
  const rng = new Rng(0xdead);
  let sim: TestSim | null = null;
  const room = new RoomCore({
    createSim: () => (sim = new TestSim()),
    seed: 1,
    send: (connId, data) => {
      if (!sent.has(connId)) sent.set(connId, []);
      sent.get(connId)!.push(JSON.parse(data));
    },
    closeConn: (connId) => closed.push(connId),
    now: () => clock.ms,
    random: () => rng.next() / 2 ** 32,
  });
  const msgs = (connId: string, type: string): Record<string, unknown>[] =>
    ((sent.get(connId) ?? []) as Record<string, unknown>[]).filter((m) => m['type'] === type);
  return {
    room,
    sim: () => sim!,
    sent,
    closed,
    clock,
    join: (connId, name = connId, token) =>
      room.handleMessage(
        connId,
        JSON.stringify({ type: 'join', playerName: name, rejoinToken: token }),
      ),
    last: (connId, type) => msgs(connId, type).at(-1),
    all: msgs,
  };
};

const inputMsg = (tick: number, bits: number, prev: number[] = []): string =>
  JSON.stringify({ type: 'input', tick, bits, prev });

describe('room codes', () => {
  it('generates 4-letter codes from the unambiguous alphabet', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 50; i++) {
      const code = makeRoomCode(() => rng.next() / 2 ** 32);
      expect(isRoomCode(code)).toBe(true);
      expect(code).not.toMatch(/[IOQ]/);
    }
    expect(isRoomCode('BLAB')).toBe(true);
    expect(isRoomCode('BLOB')).toBe(false); // O is ambiguous — not in the alphabet
    expect(isRoomCode('AB')).toBe(false);
  });
});

describe('RoomCore joins', () => {
  it('assigns lowest free slots, then spectator seats, then rejects', () => {
    const h = harness();
    for (let i = 0; i < 8; i++) h.join(`c${i}`);
    for (let i = 0; i < 4; i++) {
      expect(h.last(`c${i}`, 'welcome')).toMatchObject({ slot: i, spectator: false });
    }
    for (let i = 4; i < 8; i++) {
      expect(h.last(`c${i}`, 'welcome')).toMatchObject({ slot: -1, spectator: true });
    }
    h.join('c8');
    expect(h.last('c8', 'error')).toMatchObject({ code: 'room_full' });
    expect(h.closed).toContain('c8');
    expect(h.sim().state.joined).toEqual([0, 1, 2, 3]);
  });

  it('welcome carries a snapshot, the current tick, and a rejoin token', () => {
    const h = harness();
    h.join('a');
    const w = h.last('a', 'welcome')!;
    expect(w['tick']).toBe(0);
    expect(typeof w['snapshot']).toBe('string');
    expect((w['rejoinToken'] as string).length).toBe(32);
    expect(h.last('a', 'peerMeta')).toBeDefined();
  });

  it('messages before join get a not_joined error', () => {
    const h = harness();
    h.room.handleMessage('x', inputMsg(0, 1));
    expect(h.last('x', 'error')).toMatchObject({ code: 'not_joined' });
  });

  it('carries the chosen avatarId into peerMeta and persistence', () => {
    const h = harness();
    h.room.handleMessage('a', JSON.stringify({ type: 'join', playerName: 'a', avatarId: 'abc123' }));
    expect(h.last('a', 'peerMeta')!['slots']).toMatchObject([{ slot: 0, avatarId: 'abc123' }, null, null, null]);
    // Survives DO hibernation: a restored room still knows the avatar.
    const revived = new RoomCore(
      { createSim: () => new TestSim(), seed: 1, send: () => {}, now: () => 0, random: () => 0 },
      h.room.persist(),
    );
    expect(revived.roomInfo().players[0]).toMatchObject({ slot: 0, avatarId: 'abc123' });
  });

  it('a re-join can set or update the avatar without a token', () => {
    const h = harness();
    h.join('a'); // no avatar yet
    const slots0 = h.last('a', 'peerMeta')!['slots'] as Record<string, unknown>[];
    expect(slots0[0]!['avatarId']).toBeUndefined();
    const token = h.last('a', 'welcome')!['rejoinToken'] as string;
    h.room.handleMessage('a2', JSON.stringify({ type: 'join', playerName: 'a', avatarId: 'gallery:3', rejoinToken: token }));
    expect(h.last('a2', 'peerMeta')!['slots']).toMatchObject([{ slot: 0, avatarId: 'gallery:3' }, null, null, null]);
  });
});

describe('RoomCore inputs', () => {
  it('feeds each slot its input for the tick; missing inputs are null', () => {
    const h = harness();
    h.join('a');
    h.join('b');
    h.room.handleMessage('a', inputMsg(0, 5));
    h.room.tickOnce();
    expect(h.sim().state.received[0]).toEqual([5, null, null, null]);
  });

  it('applies late inputs at the current tick (never rewinds)', () => {
    const h = harness();
    h.join('a');
    h.room.tickOnce(); // tick 0 passes with no input
    h.room.tickOnce(); // tick 1
    h.room.handleMessage('a', inputMsg(0, 7)); // late for tick 0
    h.room.tickOnce(); // tick 2 — applies it now
    expect(h.sim().state.received[2]![0]).toBe(7);
  });

  it('redundant prev bits ride over lost messages', () => {
    const h = harness();
    h.join('a');
    // The message for tick 0 was "lost"; tick 1's message carries it in prev.
    h.room.handleMessage('a', inputMsg(1, 3, [9]));
    h.room.tickOnce();
    h.room.tickOnce();
    expect(h.sim().state.received[0]![0]).toBe(9);
    expect(h.sim().state.received[1]![0]).toBe(3);
  });

  it('holds the last input across gap ticks (send-on-change clients)', () => {
    const h = harness();
    h.join('a');
    // One input, then silence: the held value must keep being applied.
    h.room.handleMessage('a', inputMsg(0, 5));
    for (let i = 0; i < 4; i++) h.room.tickOnce();
    expect(h.sim().state.received.map((r) => r[0])).toEqual([5, 5, 5, 5]);
    // A new value replaces the held one and then holds in turn.
    h.room.handleMessage('a', inputMsg(4, 0));
    for (let i = 0; i < 3; i++) h.room.tickOnce();
    expect(h.sim().state.received.slice(4).map((r) => r[0])).toEqual([0, 0, 0]);
  });

  it('send-on-change is determinism-equivalent to streaming every tick', () => {
    // bits the player "holds" each tick (changes are sparse — the whole point).
    const seq = [3, 3, 3, 3, 1, 1, 0, 0, 0, 4, 4, 4, 4, 4, 2];
    const received = (mode: 'every-tick' | 'on-change'): (number | null)[] => {
      const h = harness();
      h.join('a');
      let last = -1;
      seq.forEach((bits, t) => {
        if (mode === 'every-tick' || bits !== last) h.room.handleMessage('a', inputMsg(t, bits));
        last = bits;
        h.room.tickOnce();
      });
      return h.sim().state.received.map((r) => r[0]!);
    };
    expect(received('on-change')).toEqual(received('every-tick'));
    expect(received('on-change')).toEqual(seq); // and it's exactly what was held
  });

  it('a disconnected slot contributes null (sim grace handles despawn)', () => {
    const h = harness();
    h.join('a');
    h.join('b');
    h.room.handleMessage('b', inputMsg(0, 2));
    h.room.handleClose('b');
    h.room.tickOnce();
    expect(h.sim().state.received[0]![1]).toBeNull();
    expect(h.last('a', 'peerMeta')).toMatchObject({
      slots: [
        { slot: 0, name: 'a', connected: true },
        { slot: 1, name: 'b', connected: false },
        null,
        null,
      ],
    });
  });
});

describe('RoomCore rejoin', () => {
  it('a token reclaims the slot within the window and calls rejoinPlayer', () => {
    const h = harness();
    h.join('a');
    h.join('b');
    const token = h.last('b', 'welcome')!['rejoinToken'] as string;
    h.room.handleClose('b');
    h.clock.ms += 5_000;
    h.join('b2', 'b again', token);
    expect(h.last('b2', 'welcome')).toMatchObject({ slot: 1, rejoinToken: token });
    expect(h.sim().state.rejoined).toEqual([1]);
  });

  it('an expired token falls through to a fresh join', () => {
    const h = harness();
    h.join('a');
    h.join('b');
    const token = h.last('b', 'welcome')!['rejoinToken'] as string;
    h.room.handleClose('b');
    h.clock.ms += (REJOIN_WINDOW_S + 1) * 1000;
    h.join('b2', 'b again', token);
    // Slots 0/1 are taken (slot 1 stays reserved in v1) — lands in slot 2.
    expect(h.last('b2', 'welcome')).toMatchObject({ slot: 2 });
  });

  it('rejoining while the old connection is open replaces it', () => {
    const h = harness();
    h.join('a');
    const token = h.last('a', 'welcome')!['rejoinToken'] as string;
    h.join('a2', 'a-phone', token);
    expect(h.last('a2', 'welcome')).toMatchObject({ slot: 0 });
    expect(h.closed).toContain('a');
  });
});

describe('RoomCore broadcasting', () => {
  it('snapshots every SNAPSHOT_EVERY ticks, hashcheck every HASHCHECK_EVERY', () => {
    const h = harness();
    h.join('a');
    for (let i = 0; i < HASHCHECK_EVERY; i++) h.room.tickOnce();
    const snaps = h.all('a', 'snapshot');
    expect(snaps).toHaveLength(HASHCHECK_EVERY / SNAPSHOT_EVERY);
    expect(snaps[0]).toMatchObject({ tick: 3 });
    const checks = h.all('a', 'hashcheck');
    expect(checks).toHaveLength(1);
    expect(checks[0]!['tick']).toBe(HASHCHECK_EVERY);
    // The hash must match the snapshot state at the same tick.
    const snap = snaps.at(-1)!;
    const verify = new TestSim();
    verify.restore(snap['state'] as string);
    expect(checks[0]!['hash']).toBe(verify.hash());
  });

  it('emotes broadcast to everyone but are rate-limited per slot', () => {
    const h = harness();
    h.join('a');
    h.join('b');
    const emote = JSON.stringify({ type: 'emote', kind: 'help' });
    h.room.handleMessage('a', emote);
    h.room.handleMessage('a', emote); // dropped: too soon
    expect(h.all('b', 'emote')).toHaveLength(1);
    for (let i = 0; i < EMOTE_RATE_TICKS; i++) h.room.tickOnce();
    h.room.handleMessage('a', emote);
    expect(h.all('b', 'emote')).toHaveLength(2);
    expect(h.all('a', 'emote')).toHaveLength(2); // sender sees it too
  });

  it('announces level events on mode transitions', () => {
    const h = harness();
    h.join('a');
    for (let i = 0; i < 50; i++) h.room.tickOnce(); // TestSim flips at tick 50
    expect(h.all('a', 'levelEvent')).toHaveLength(1);
    expect(h.last('a', 'levelEvent')).toMatchObject({ kind: 'levelclear' });
  });

  it('answers pings with the server tick', () => {
    const h = harness();
    h.join('a');
    h.room.tickOnce();
    h.room.handleMessage('a', JSON.stringify({ type: 'ping', t: 123 }));
    expect(h.last('a', 'pong')).toMatchObject({ t: 123, serverTick: 1 });
  });

  it('resync returns a fresh snapshot', () => {
    const h = harness();
    h.join('a');
    h.room.tickOnce();
    h.room.handleMessage('a', JSON.stringify({ type: 'resync' }));
    expect(h.last('a', 'snapshot')).toMatchObject({ tick: 1 });
  });
});

describe('RoomCore persistence (DO hibernation/eviction)', () => {
  it('persist + restore keeps sim state and rejoin tokens valid', () => {
    const h = harness();
    h.join('a');
    h.room.handleMessage('a', inputMsg(0, 5));
    h.room.tickOnce();
    const token = h.last('a', 'welcome')!['rejoinToken'] as string;
    const blob = h.room.persist();

    // A brand-new core (fresh DO instance) restores from storage.
    const sent2 = new Map<string, unknown[]>();
    let sim2: TestSim | null = null;
    const room2 = new RoomCore(
      {
        createSim: () => (sim2 = new TestSim()),
        seed: 1,
        send: (connId, data) => {
          if (!sent2.has(connId)) sent2.set(connId, []);
          sent2.get(connId)!.push(JSON.parse(data));
        },
        now: () => 0,
        random: () => 0.5,
      },
      blob,
    );
    expect(room2.tick).toBe(1);
    expect(sim2!.state.received[0]).toEqual([5, null, null, null]);
    room2.handleMessage('a2', JSON.stringify({ type: 'join', playerName: 'a', rejoinToken: token }));
    const w = (sent2.get('a2') as Record<string, unknown>[]).find((m) => m['type'] === 'welcome')!;
    expect(w).toMatchObject({ slot: 0, rejoinToken: token });
  });
});
