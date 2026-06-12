/**
 * RoomCore: the authoritative game room, with transport and clock injected.
 * The Durable Object in workers/rooms wraps this with real WebSockets and a
 * 60 Hz driver; tests wrap it with fake ones. RoomCore itself never touches
 * the network or wall clock directly.
 */
import {
  EMOTE_RATE_TICKS,
  HASHCHECK_EVERY,
  MAX_SPECTATORS,
  REJOIN_WINDOW_S,
  SNAPSHOT_EVERY,
  parseClientMsg,
  type ClientMsg,
  type PeerSlotMeta,
  type ServerMsg,
} from '../protocol';

/** What the room needs from a game sim (BubbleBuddiesSim satisfies this). */
export interface NetSim {
  state: { tick: number; mode: string };
  tick(inputs: readonly (number | null)[]): void;
  serialize(): string;
  hash(): number;
  snapshot(): string;
  restore(json: string): void;
  joinPlayer(slot: number): void;
  rejoinPlayer(slot: number): void;
}

export interface RoomCoreOptions {
  createSim: (seed: number) => NetSim;
  seed: number;
  send: (connId: string, data: string) => void;
  closeConn?: (connId: string, code: number, reason: string) => void;
  /** Wall-clock ms (rejoin window); injectable for tests. */
  now: () => number;
  /** Uniform [0,1) for rejoin tokens; injectable for tests. */
  random: () => number;
  /** Fired when a connection is assigned a slot (-1 = spectator). The DO
   *  wrapper uses this to stamp WebSocket attachments for hibernation. */
  onJoin?: (connId: string, slot: number) => void;
}

interface SlotMeta {
  name: string;
  token: string;
  connId: string | null;
  disconnectedAtMs: number | null;
}

/** Persisted shape (DO storage): everything but live connections. */
interface PersistedRoom {
  seed: number;
  snapshot: string | null;
  slots: ({ name: string; token: string; disconnectedAtMs: number | null } | null)[];
  lastEmoteTick: number[];
}

/** 128-bit hex token from a [0,1) random source. */
export const makeToken = (random: () => number): string =>
  Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16)).join('');

const LEVEL_EVENTS = new Set(['levelclear', 'gameover', 'win']);
/** Ignore inputs stamped more than this many ticks into the future. */
const MAX_INPUT_LEAD = 300;

export class RoomCore {
  private readonly opts: RoomCoreOptions;
  private sim: NetSim | null = null;
  private readonly slots: (SlotMeta | null)[] = [null, null, null, null];
  /** connId → slot index, or -1 for spectators. */
  private readonly conns = new Map<string, number>();
  private spectatorCount = 0;
  /** Per-slot pending inputs: tick → bits. */
  private readonly inputs = [
    new Map<number, number>(),
    new Map<number, number>(),
    new Map<number, number>(),
    new Map<number, number>(),
  ];
  private lastEmoteTick = [-EMOTE_RATE_TICKS, -EMOTE_RATE_TICKS, -EMOTE_RATE_TICKS, -EMOTE_RATE_TICKS];

  constructor(opts: RoomCoreOptions, persisted?: string) {
    this.opts = opts;
    if (persisted) {
      const p = JSON.parse(persisted) as PersistedRoom;
      if (p.snapshot !== null) {
        this.sim = opts.createSim(p.seed);
        this.sim.restore(p.snapshot);
      }
      p.slots.forEach((s, i) => {
        this.slots[i] = s ? { ...s, connId: null } : null;
      });
      this.lastEmoteTick = p.lastEmoteTick;
    }
  }

  get tick(): number {
    return this.sim?.state.tick ?? 0;
  }

  hasClients(): boolean {
    return this.conns.size > 0;
  }

  /** Rebind a connection that survived DO hibernation (slot from attachment). */
  attach(connId: string, slot: number): void {
    this.conns.set(connId, slot);
    if (slot >= 0) {
      const meta = this.slots[slot];
      if (meta) {
        meta.connId = connId;
        meta.disconnectedAtMs = null;
      }
    } else {
      this.spectatorCount++;
    }
  }

  persist(): string {
    const p: PersistedRoom = {
      seed: this.opts.seed,
      snapshot: this.sim?.snapshot() ?? null,
      slots: this.slots.map((s) =>
        s ? { name: s.name, token: s.token, disconnectedAtMs: s.disconnectedAtMs } : null,
      ),
      lastEmoteTick: this.lastEmoteTick,
    };
    return JSON.stringify(p);
  }

  /** For the invite page: who's here, without joining. */
  roomInfo(): { players: PeerSlotMeta[]; spectators: number; tick: number } {
    return {
      players: this.peerSlots().filter((s): s is PeerSlotMeta => s !== null),
      spectators: this.spectatorCount,
      tick: this.tick,
    };
  }

  // --- Connection lifecycle ---

  handleMessage(connId: string, raw: unknown): void {
    const msg = parseClientMsg(raw);
    if (!msg) {
      this.sendTo(connId, { type: 'error', code: 'bad_message', message: 'malformed message' });
      return;
    }
    if (msg.type === 'join') {
      this.handleJoin(connId, msg);
      return;
    }
    const slot = this.conns.get(connId);
    if (slot === undefined) {
      this.sendTo(connId, { type: 'error', code: 'not_joined', message: 'join first' });
      return;
    }
    switch (msg.type) {
      case 'input':
        if (slot >= 0) this.bufferInput(slot, msg);
        break;
      case 'emote':
        if (slot >= 0 && this.tick - this.lastEmoteTick[slot]! >= EMOTE_RATE_TICKS) {
          this.lastEmoteTick[slot] = this.tick;
          this.broadcast({ type: 'emote', slot, kind: msg.kind });
        }
        break;
      case 'ping':
        this.sendTo(connId, { type: 'pong', t: msg.t, serverTick: this.tick });
        break;
      case 'resync':
        if (this.sim) {
          this.sendTo(connId, { type: 'snapshot', tick: this.tick, state: this.sim.snapshot() });
        }
        break;
    }
  }

  handleClose(connId: string): void {
    const slot = this.conns.get(connId);
    if (slot === undefined) return;
    this.conns.delete(connId);
    if (slot >= 0) {
      const meta = this.slots[slot];
      if (meta && meta.connId === connId) {
        meta.connId = null;
        meta.disconnectedAtMs = this.opts.now();
      }
    } else {
      this.spectatorCount = Math.max(0, this.spectatorCount - 1);
    }
    this.broadcastPeerMeta();
  }

  private handleJoin(connId: string, msg: ClientMsg & { type: 'join' }): void {
    // Rejoin: a matching token reclaims the slot (and score) within the window.
    if (msg.rejoinToken) {
      const slot = this.slots.findIndex((s) => s !== null && s.token === msg.rejoinToken);
      const meta = slot >= 0 ? this.slots[slot]! : null;
      if (meta) {
        const within =
          meta.connId !== null ||
          meta.disconnectedAtMs === null ||
          this.opts.now() - meta.disconnectedAtMs <= REJOIN_WINDOW_S * 1000;
        if (within) {
          if (meta.connId && meta.connId !== connId) {
            this.conns.delete(meta.connId);
            this.opts.closeConn?.(meta.connId, 4000, 'session resumed elsewhere');
          }
          meta.connId = connId;
          meta.disconnectedAtMs = null;
          meta.name = msg.playerName;
          this.conns.set(connId, slot);
          this.sim?.rejoinPlayer(slot);
          this.welcome(connId, slot, meta.token);
          this.broadcastPeerMeta();
          return;
        }
      }
    }

    // Fresh join: lowest free slot, else spectator seat, else full.
    const slot = this.slots.findIndex((s) => s === null);
    if (slot >= 0) {
      if (!this.sim) this.sim = this.opts.createSim(this.opts.seed);
      const token = makeToken(this.opts.random);
      this.slots[slot] = {
        name: msg.playerName,
        token,
        connId,
        disconnectedAtMs: null,
      };
      this.conns.set(connId, slot);
      this.sim.joinPlayer(slot);
      this.welcome(connId, slot, token);
      this.broadcastPeerMeta();
      return;
    }
    if (this.spectatorCount < MAX_SPECTATORS) {
      this.spectatorCount++;
      this.conns.set(connId, -1);
      this.welcome(connId, -1, '');
      this.broadcastPeerMeta();
      return;
    }
    this.sendTo(connId, { type: 'error', code: 'room_full', message: 'room is full' });
    this.opts.closeConn?.(connId, 4001, 'room full');
  }

  private welcome(connId: string, slot: number, token: string): void {
    this.opts.onJoin?.(connId, slot);
    this.sendTo(connId, {
      type: 'welcome',
      slot,
      spectator: slot < 0,
      rejoinToken: token,
      tick: this.tick,
      snapshot: this.sim?.snapshot() ?? '',
    });
  }

  // --- Inputs (spec: applied at max(receivedTick, serverTick), never rewound) ---

  private bufferInput(slot: number, msg: ClientMsg & { type: 'input' }): void {
    const buf = this.inputs[slot]!;
    const t = this.tick;
    const store = (tick: number, bits: number): void => {
      if (tick > t + MAX_INPUT_LEAD) return; // absurdly far ahead — drop
      if (!buf.has(tick)) buf.set(tick, bits);
    };
    store(msg.tick, msg.bits);
    msg.prev.forEach((bits, i) => store(msg.tick - 1 - i, bits));
    if (buf.size > 2 * MAX_INPUT_LEAD) buf.clear(); // defensive bound
  }

  /** Latest buffered input at or before tick `t` (late inputs apply now). */
  private takeInput(slot: number, t: number): number | null {
    const buf = this.inputs[slot]!;
    let chosen: number | null = null;
    let chosenTick = -1;
    for (const [tick, bits] of buf) {
      if (tick <= t && tick > chosenTick) {
        chosenTick = tick;
        chosen = bits;
      }
    }
    if (chosenTick >= 0) {
      for (const tick of [...buf.keys()]) {
        if (tick <= t) buf.delete(tick);
      }
    }
    return chosen;
  }

  // --- The authoritative tick ---

  /** Advance the sim exactly one tick. The wrapper drives cadence (60 Hz). */
  tickOnce(): void {
    const sim = this.sim;
    if (!sim) return;
    const t = sim.state.tick;
    const inputs = this.slots.map((meta, slot) => {
      if (!meta) return null;
      if (meta.connId === null) return null; // disconnected → sim grace rule
      return this.takeInput(slot, t);
    });
    const modeBefore = sim.state.mode;
    sim.tick(inputs);
    const now = sim.state.tick;

    if (sim.state.mode !== modeBefore && LEVEL_EVENTS.has(sim.state.mode)) {
      this.broadcast({
        type: 'levelEvent',
        kind: sim.state.mode as 'levelclear' | 'gameover' | 'win',
      });
    }
    if (now % SNAPSHOT_EVERY === 0) {
      this.broadcast({ type: 'snapshot', tick: now, state: sim.snapshot() });
    }
    if (now % HASHCHECK_EVERY === 0) {
      this.broadcast({ type: 'hashcheck', tick: now, hash: sim.hash() });
    }
  }

  // --- Outbound ---

  private peerSlots(): (PeerSlotMeta | null)[] {
    return this.slots.map((s, slot) =>
      s ? { slot, name: s.name, connected: s.connId !== null } : null,
    );
  }

  private broadcastPeerMeta(): void {
    this.broadcast({
      type: 'peerMeta',
      slots: this.peerSlots(),
      spectators: this.spectatorCount,
    });
  }

  private sendTo(connId: string, msg: ServerMsg): void {
    this.opts.send(connId, JSON.stringify(msg));
  }

  private broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const connId of this.conns.keys()) this.opts.send(connId, data);
  }
}
