/**
 * GameRoomDO: one Durable Object per room (ADR-001), wrapping the
 * transport-agnostic RoomCore with real WebSockets (hibernation API), a
 * 60 Hz drift-corrected tick driver, periodic persistence, and a 24 h
 * expiry alarm. SQLite-backed (free plan) — see wrangler.jsonc migrations.
 */
import { DurableObject } from 'cloudflare:workers';
import { ROOM_TTL_S, RoomCore } from '@retro-recall/netcode';
import { DEFAULT_GAME, simFactory } from './games';
import type { Env } from './index';

const TICK_MS = 1000 / 60;
/** Persist the room to storage every N ticks (~10 s) and on quiet. */
const PERSIST_EVERY_TICKS = 600;
/** Cap catch-up after a stall; beyond this the clock just jumps. */
const MAX_CATCHUP_TICKS = 120;

interface SocketAttachment {
  connId: string;
  slot: number; // -2 = connected but not joined, -1 = spectator
}

export class GameRoomDO extends DurableObject<Env> {
  private core: RoomCore | null = null;
  private sockets = new Map<string, WebSocket>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastTickMs = 0;
  private ticksSincePersist = 0;

  private async ensureCore(): Promise<RoomCore> {
    if (this.core) return this.core;
    let seed = await this.ctx.storage.get<number>('seed');
    if (seed === undefined) {
      seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
      await this.ctx.storage.put('seed', seed);
    }
    const persisted = await this.ctx.storage.get<string>('room');
    // Which game this room hosts (default keeps pre-registry rooms on the
    // original sim, byte-for-byte). Player count 0: all players enter via
    // joinPlayer().
    const game = await this.ctx.storage.get<string>('game');
    this.core = new RoomCore(
      {
        createSim: simFactory(game),
        seed,
        send: (connId, data) => {
          try {
            this.sockets.get(connId)?.send(data);
          } catch {
            // Socket already gone; close handler will clean up.
          }
        },
        closeConn: (connId, code, reason) => {
          try {
            this.sockets.get(connId)?.close(code, reason);
          } catch {
            // Already closed.
          }
          this.sockets.delete(connId);
        },
        now: () => Date.now(),
        random: () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32,
        onJoin: (connId, slot) => {
          const ws = this.sockets.get(connId);
          if (ws) ws.serializeAttachment({ connId, slot } satisfies SocketAttachment);
        },
      },
      persisted,
    );
    // Re-bind any sockets that survived hibernation or an eviction.
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (!att) continue;
      this.sockets.set(att.connId, ws);
      if (att.slot >= -1) this.core.attach(att.connId, att.slot);
    }
    return this.core;
  }

  // --- RPC (called by the routing worker / tests) ---

  /** Stamp the room with its code and game, and arm the expiry alarm. */
  async init(code: string, game?: string): Promise<void> {
    await this.ctx.storage.put('code', code);
    if (game !== undefined) await this.ctx.storage.put('game', game);
    await this.touchActivity();
  }

  async roomInfo(): Promise<{
    code: string;
    /** Which game this room hosts — lets the library route a typed code to the
     *  right play page now that more than one game is live. */
    game: string;
    players: { slot: number; name: string; connected: boolean }[];
    spectators: number;
    tick: number;
  }> {
    const core = await this.ensureCore();
    const code = (await this.ctx.storage.get<string>('code')) ?? '';
    const game = (await this.ctx.storage.get<string>('game')) ?? DEFAULT_GAME;
    return { code, game, ...core.roomInfo() };
  }

  /** Test driver: advance the sim N ticks synchronously (auto-tick is off
   *  in the vitest config; harmless in production). */
  async debugAdvance(n: number): Promise<number> {
    const core = await this.ensureCore();
    for (let i = 0; i < n; i++) core.tickOnce();
    await this.persist();
    return core.tick;
  }

  // --- WebSocket lifecycle (hibernation API) ---

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    await this.ensureCore();
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const connId = crypto.randomUUID();
    server.serializeAttachment({ connId, slot: -2 } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server);
    this.sockets.set(connId, server);
    await this.touchActivity();
    this.startTicking();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    const core = await this.ensureCore();
    const att = ws.deserializeAttachment() as SocketAttachment;
    if (!this.sockets.has(att.connId)) this.sockets.set(att.connId, ws);
    core.handleMessage(att.connId, message);
    this.startTicking();
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const core = await this.ensureCore();
    const att = ws.deserializeAttachment() as SocketAttachment;
    this.sockets.delete(att.connId);
    core.handleClose(att.connId);
    await this.touchActivity();
    if (!core.hasClients()) {
      this.stopTicking();
      await this.persist();
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // --- 60 Hz driver (runs only while clients are connected) ---

  private startTicking(): void {
    if (this.interval || this.env.DISABLE_AUTO_TICK === '1') return;
    this.lastTickMs = Date.now();
    this.interval = setInterval(() => void this.pump(), TICK_MS);
  }

  private stopTicking(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  private async pump(): Promise<void> {
    const core = this.core;
    if (!core) return;
    const now = Date.now();
    let n = Math.floor((now - this.lastTickMs) / TICK_MS);
    if (n <= 0) return;
    if (n > MAX_CATCHUP_TICKS) {
      this.lastTickMs = now - MAX_CATCHUP_TICKS * TICK_MS;
      n = MAX_CATCHUP_TICKS;
    }
    this.lastTickMs += n * TICK_MS;
    for (let i = 0; i < n; i++) core.tickOnce();
    this.ticksSincePersist += n;
    if (this.ticksSincePersist >= PERSIST_EVERY_TICKS) {
      this.ticksSincePersist = 0;
      await this.persist();
    }
    if (!core.hasClients()) {
      this.stopTicking();
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    if (this.core) await this.ctx.storage.put('room', this.core.persist());
  }

  // --- Expiry (codes + room state die 24 h after last activity) ---

  private async touchActivity(): Promise<void> {
    const now = Date.now();
    await this.ctx.storage.put('lastActivityMs', now);
    await this.ctx.storage.setAlarm(now + ROOM_TTL_S * 1000);
  }

  override async alarm(): Promise<void> {
    const last = (await this.ctx.storage.get<number>('lastActivityMs')) ?? 0;
    const expired = Date.now() - last >= ROOM_TTL_S * 1000;
    if (expired && this.ctx.getWebSockets().length === 0) {
      this.stopTicking();
      this.core = null;
      await this.ctx.storage.deleteAll(); // also clears the alarm
    } else {
      await this.ctx.storage.setAlarm(last + ROOM_TTL_S * 1000);
    }
  }
}
