/**
 * DO integration tests (miniflare via vitest-pool-workers): room creation,
 * the join → input → snapshot → emote → rejoin flow over real WebSockets,
 * and expiry. Auto-ticking is disabled (DISABLE_AUTO_TICK); the sim is
 * driven deterministically through the debugAdvance RPC.
 */
import { SELF, env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { GameRoomDO } from '../src/index';

interface CreateResponse {
  code: string;
  url: string;
}

const createRoom = async (): Promise<CreateResponse> => {
  const res = await SELF.fetch('https://rooms.test/api/rooms', { method: 'POST' });
  expect(res.status).toBe(200);
  return res.json();
};

const stubFor = async (code: string): Promise<DurableObjectStub<GameRoomDO>> => {
  const idStr = await env.ROOMS.get(code);
  expect(idStr).not.toBeNull();
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromString(idStr!));
};

/** Open a room WebSocket and collect every message it receives. */
const connect = async (
  code: string,
): Promise<{ ws: WebSocket; messages: Record<string, unknown>[] }> => {
  const res = await SELF.fetch(`https://rooms.test/room/${code}`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const messages: Record<string, unknown>[] = [];
  ws.accept();
  ws.addEventListener('message', (e) => {
    messages.push(JSON.parse(e.data as string));
  });
  return { ws, messages };
};

const join = (ws: WebSocket, name: string, rejoinToken?: string): void =>
  ws.send(JSON.stringify({ type: 'join', playerName: name, rejoinToken }));

/** Wait until the predicate holds (messages arrive asynchronously). */
const until = async (pred: () => boolean, ms = 2000): Promise<void> => {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for messages');
    await new Promise((r) => setTimeout(r, 10));
  }
};

const ofType = (messages: Record<string, unknown>[], type: string): Record<string, unknown>[] =>
  messages.filter((m) => m['type'] === type);

describe('room creation', () => {
  it('POST /api/rooms returns a code from the unambiguous alphabet and a share URL', async () => {
    const { code, url } = await createRoom();
    expect(code).toMatch(/^[ABCDEFGHJKLMNPRSTUVWXYZ]{4}$/);
    expect(url).toBe(`https://retro-recall.ruralrooted.com/play/bubble-buddies?room=${code}`);
    expect(await env.ROOMS.get(code)).not.toBeNull();
  });

  it('unknown or malformed codes 404', async () => {
    expect((await SELF.fetch('https://rooms.test/api/rooms/ZZZZ')).status).toBe(404);
    expect((await SELF.fetch('https://rooms.test/room/QQQQ')).status).toBe(404);
    expect((await SELF.fetch('https://rooms.test/api/rooms/ABCDE')).status).toBe(404);
  });

  it('throttles the TTL-refresh KV write across rapid lookups (Free 1k writes/day cap)', async () => {
    const { code } = await createRoom();
    const seeded = await env.ROOMS.getWithMetadata<{ t: number }>(code);
    expect(seeded.metadata?.t).toBeTypeOf('number'); // create seeds the refresh stamp
    // A burst of lookups well inside the refresh window must not re-write the key.
    for (let i = 0; i < 5; i++) {
      expect((await SELF.fetch(`https://rooms.test/api/rooms/${code}`)).status).toBe(200);
    }
    const after = await env.ROOMS.getWithMetadata<{ t: number }>(code);
    expect(after.metadata?.t).toBe(seeded.metadata?.t); // no extra writes
  });
});

describe('join / play / snapshot flow', () => {
  it('welcomes players into slots with a snapshot; snapshots flow at 20 Hz', async () => {
    const { code } = await createRoom();
    const a = await connect(code);
    join(a.ws, 'kevin');
    await until(() => ofType(a.messages, 'welcome').length === 1);
    const welcome = ofType(a.messages, 'welcome')[0]!;
    expect(welcome).toMatchObject({ slot: 0, spectator: false, tick: 0 });
    const state = JSON.parse(welcome['snapshot'] as string) as {
      players: ({ phase: string } | null)[];
    };
    expect(state.players[0]!.phase).toBe('alive');

    const b = await connect(code);
    join(b.ws, 'friend');
    await until(() => ofType(b.messages, 'welcome').length === 1);
    expect(ofType(b.messages, 'welcome')[0]).toMatchObject({ slot: 1 });

    const stub = await stubFor(code);
    await stub.debugAdvance(6);
    await until(() => ofType(a.messages, 'snapshot').length >= 2);
    expect(ofType(a.messages, 'snapshot').map((s) => s['tick'])).toEqual([3, 6]);
  });

  it('applies inputs: holding Right moves slot 0 in the next snapshots', async () => {
    const { code } = await createRoom();
    const a = await connect(code);
    join(a.ws, 'mover');
    await until(() => ofType(a.messages, 'welcome').length === 1);
    const startState = JSON.parse(
      ofType(a.messages, 'welcome')[0]!['snapshot'] as string,
    ) as { players: { x: number }[] };
    const startX = startState.players[0]!.x;

    const RIGHT = 1 << 1;
    for (let t = 0; t < 12; t++) {
      a.ws.send(JSON.stringify({ type: 'input', tick: t, bits: RIGHT, prev: [RIGHT, RIGHT, RIGHT] }));
    }
    // Ping/pong barrier: sockets process in order, so the pong proves every
    // input above reached the room before we advance the sim.
    a.ws.send(JSON.stringify({ type: 'ping', t: 1 }));
    await until(() => ofType(a.messages, 'pong').length === 1);
    const stub = await stubFor(code);
    await stub.debugAdvance(12);
    await until(() => ofType(a.messages, 'snapshot').length >= 4);
    const last = ofType(a.messages, 'snapshot').at(-1)!;
    const endState = JSON.parse(last['state'] as string) as { players: { x: number }[] };
    expect(endState.players[0]!.x).toBe(startX + 12 * 288); // PLAYER_WALK_SPEED
  });

  it('holds a held button across gap ticks (send-on-change clients)', async () => {
    const { code } = await createRoom();
    const a = await connect(code);
    join(a.ws, 'holder');
    await until(() => ofType(a.messages, 'welcome').length === 1);
    const startX = (
      JSON.parse(ofType(a.messages, 'welcome')[0]!['snapshot'] as string) as {
        players: { x: number }[];
      }
    ).players[0]!.x;

    const RIGHT = 1 << 1;
    // A single input, as a send-on-change client emits it — the room must hold
    // it for every following tick rather than reverting to "no input".
    a.ws.send(JSON.stringify({ type: 'input', tick: 0, bits: RIGHT }));
    a.ws.send(JSON.stringify({ type: 'ping', t: 1 }));
    await until(() => ofType(a.messages, 'pong').length === 1);
    const stub = await stubFor(code);
    await stub.debugAdvance(12);
    await until(() => ofType(a.messages, 'snapshot').length >= 4);
    const endState = JSON.parse(ofType(a.messages, 'snapshot').at(-1)!['state'] as string) as {
      players: { x: number }[];
    };
    expect(endState.players[0]!.x).toBe(startX + 12 * 288); // moved all 12 ticks
  });

  it('reaps connections that go silent past the idle window', async () => {
    const { code } = await createRoom();
    const a = await connect(code);
    let aClosed = false;
    a.ws.addEventListener('close', () => {
      aClosed = true;
    });
    join(a.ws, 'idler');
    await until(() => ofType(a.messages, 'welcome').length === 1);
    const stub = await stubFor(code);

    // Still connected right now; a sweep far in the future reaps it.
    expect(await stub.debugReapIdle(Date.now())).toBe(true);
    expect(await stub.debugReapIdle(Date.now() + 60_000)).toBe(false);
    await until(() => aClosed);
  });

  it('hashcheck arrives at tick 600 and matches the snapshot state', async () => {
    const { code } = await createRoom();
    const a = await connect(code);
    join(a.ws, 'hasher');
    await until(() => ofType(a.messages, 'welcome').length === 1);
    const stub = await stubFor(code);
    await stub.debugAdvance(600);
    await until(() => ofType(a.messages, 'hashcheck').length === 1);
    expect(ofType(a.messages, 'hashcheck')[0]).toMatchObject({ tick: 600 });
    expect(ofType(a.messages, 'snapshot').at(-1)!['tick']).toBe(600);
  });

  it('rate-limits emotes server-side (1 per 30 ticks)', async () => {
    const { code } = await createRoom();
    const a = await connect(code);
    const b = await connect(code);
    join(a.ws, 'emoter');
    join(b.ws, 'watcher');
    await until(() => ofType(b.messages, 'welcome').length === 1);

    a.ws.send(JSON.stringify({ type: 'emote', kind: 'help' }));
    a.ws.send(JSON.stringify({ type: 'emote', kind: 'nice' }));
    a.ws.send(JSON.stringify({ type: 'emote', kind: 'free text!' })); // invalid kind
    const stub = await stubFor(code);
    await stub.debugAdvance(30);
    a.ws.send(JSON.stringify({ type: 'emote', kind: 'heart' }));
    await until(() => ofType(b.messages, 'emote').length >= 2);
    expect(ofType(b.messages, 'emote').map((m) => m['kind'])).toEqual(['help', 'heart']);
  });

  it('rejoin token reclaims the slot after a disconnect', async () => {
    const { code } = await createRoom();
    const a = await connect(code);
    join(a.ws, 'kevin');
    await until(() => ofType(a.messages, 'welcome').length === 1);
    const token = ofType(a.messages, 'welcome')[0]!['rejoinToken'] as string;

    const b = await connect(code);
    join(b.ws, 'friend');
    await until(() => ofType(b.messages, 'welcome').length === 1);

    a.ws.close();
    await until(() => {
      const meta = ofType(b.messages, 'peerMeta').at(-1);
      if (!meta) return false;
      const slots = meta['slots'] as ({ connected: boolean } | null)[];
      return slots[0] !== null && slots[0].connected === false;
    });

    const a2 = await connect(code);
    join(a2.ws, 'kevin', token);
    await until(() => ofType(a2.messages, 'welcome').length === 1);
    expect(ofType(a2.messages, 'welcome')[0]).toMatchObject({ slot: 0, rejoinToken: token });
  });
});

describe('expiry', () => {
  it('the alarm wipes storage once the room is idle past its TTL', async () => {
    const { code } = await createRoom();
    const stub = await stubFor(code);
    await stub.debugAdvance(1); // materialize some room state
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.get('room')).toBeDefined();
      // Backdate activity to two days ago.
      await state.storage.put('lastActivityMs', Date.now() - 2 * 24 * 60 * 60 * 1000);
    });
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.get('room')).toBeUndefined();
      expect(await state.storage.get('seed')).toBeUndefined();
    });
  });
});
