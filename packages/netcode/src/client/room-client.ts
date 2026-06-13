/**
 * RoomClient: client-side netcode per SPEC.md and ADR-003.
 *
 * - sends the local pad state only when it changes (plus a low-rate keepalive);
 *   the server holds the last input across gap ticks, so a still player streams
 *   nothing — this is what keeps the room within the Workers Free request cap
 * - predicts the local player by running the same deterministic sim ahead
 *   of the server, rebasing onto every snapshot and replaying buffered
 *   local inputs
 * - keeps the last two snapshots so the view layer can interpolate remote
 *   entities (~50 ms display delay)
 * - verifies hashchecks against restored snapshots; on mismatch logs the
 *   tick (determinism gold) and requests a resync
 *
 * Timer-free and clock-injected: the shell drives it at 60 Hz via
 * localTick(); tests drive it manually.
 */
import {
  EMOTE_DISPLAY_TICKS,
  HASHCHECK_EVERY,
  INPUT_KEEPALIVE_TICKS,
  parseServerMsg,
  type EmoteKind,
  type PeerSlotMeta,
} from '../protocol';
import type { NetSim } from '../room/core';
import type { Transport } from './transport';

export interface SnapshotRef {
  tick: number;
  state: string;
}

export type RoomClientEvent =
  | { kind: 'status'; status: RoomClientStatus }
  | { kind: 'levelEvent'; event: 'levelclear' | 'gameover' | 'win' }
  | { kind: 'peers'; slots: (PeerSlotMeta | null)[]; spectators: number }
  | { kind: 'desync'; tick: number }
  | { kind: 'error'; code: string; message: string };

export type RoomClientStatus = 'idle' | 'connecting' | 'active' | 'disconnected' | 'full';

export interface RoomClientOptions<S extends NetSim> {
  /** Fresh transport per (re)connect attempt. */
  connect: () => Transport;
  /** Blank sim to restore snapshots into (seed irrelevant). */
  createSim: () => S;
  playerName: string;
  /** Chosen avatar (generated id or fallback id); sent with join. */
  avatarId?: string;
  /** Resume a previous session's slot + score. */
  rejoinToken?: string;
  onEvent?: (ev: RoomClientEvent) => void;
  /** Wall-clock ms for RTT measurement (injectable). */
  now?: () => number;
}

const PING_EVERY_TICKS = 60;
const MIN_LEAD = 3;
const MAX_LEAD = 30;

export class RoomClient<S extends NetSim> {
  readonly opts: RoomClientOptions<S>;
  private transport: Transport | null = null;

  status: RoomClientStatus = 'idle';
  slot = -1;
  spectator = false;
  rejoinToken: string | undefined;
  peers: (PeerSlotMeta | null)[] = [null, null, null, null];
  spectators = 0;
  rttMs = 80; // assumption until the first pong
  /** Desync log — these are determinism bugs, file them. */
  readonly desyncs: { tick: number; serverHash: number; localHash: number }[] = [];

  /** Predicted sim: server snapshot + replayed local inputs (lead ticks ahead). */
  predicted: S | null = null;
  /** Last two snapshots for remote-entity interpolation. */
  snapPrev: SnapshotRef | null = null;
  snapLatest: SnapshotRef | null = null;
  /** Active emotes: slot → kind + sim tick they expire at. */
  readonly emotes = new Map<number, { kind: EmoteKind; untilTick: number }>();

  /** The tick the next local input will be stamped with. */
  private inputTick = 0;
  /** Last bits actually sent to the server (-1 → force a send on first tick). */
  private lastSentBits = -1;
  /** Ticks since the last input send, for the keepalive floor. */
  private ticksSinceInputSend = 0;
  private ownInputs = new Map<number, number>();
  private hashAtTick = new Map<number, number>();
  private tickAdjust = 0; // +n: skip n increments (we're ahead); -n: extra ticks
  private ticksSincePing = 0;
  private readonly now: () => number;

  constructor(opts: RoomClientOptions<S>) {
    this.opts = opts;
    this.rejoinToken = opts.rejoinToken;
    this.now = opts.now ?? (() => Date.now());
  }

  start(): void {
    this.setStatus('connecting');
    const t = this.opts.connect();
    this.transport = t;
    t.onOpen = () => {
      t.send(
        JSON.stringify({
          type: 'join',
          playerName: this.opts.playerName,
          avatarId: this.opts.avatarId,
          rejoinToken: this.rejoinToken,
        }),
      );
    };
    t.onMessage = (data) => this.handleMessage(data);
    t.onClose = () => {
      if (this.status !== 'full') this.setStatus('disconnected');
    };
  }

  /** Reconnect with the held rejoin token (shell decides when/how often). */
  reconnect(): void {
    this.transport?.close();
    this.start();
  }

  close(): void {
    this.transport?.close();
    this.transport = null;
    this.setStatus('idle');
  }

  /**
   * Drive once per 60 Hz shell tick with the sampled local pad state.
   * Returns the predicted sim tick (the client's display clock).
   */
  localTick(bits: number): number {
    const sim = this.predicted;
    if (this.status !== 'active' || !sim) return 0;

    // Clock steering: drift toward serverTick + lead, one tick at a time.
    let steps = 1;
    if (this.tickAdjust > 0) {
      this.tickAdjust--;
      steps = 0;
    } else if (this.tickAdjust < 0) {
      this.tickAdjust++;
      steps = 2;
    }

    for (let i = 0; i < steps; i++) {
      if (!this.spectator) {
        // Record every tick (prediction replay needs the full local history),
        // but only send when the pad changes — plus a keepalive floor. The
        // server holds the last input for the gap ticks.
        this.ownInputs.set(this.inputTick, bits);
        if (bits !== this.lastSentBits || ++this.ticksSinceInputSend >= INPUT_KEEPALIVE_TICKS) {
          this.transport?.send(JSON.stringify({ type: 'input', tick: this.inputTick, bits }));
          this.lastSentBits = bits;
          this.ticksSinceInputSend = 0;
        }
      }
      sim.tick(this.predictionInputs(bits));
      this.inputTick++;
    }

    this.ticksSincePing++;
    if (this.ticksSincePing >= PING_EVERY_TICKS) {
      this.ticksSincePing = 0;
      this.transport?.send(JSON.stringify({ type: 'ping', t: this.now() }));
    }
    for (const [slot, e] of this.emotes) {
      if (sim.state.tick >= e.untilTick) this.emotes.delete(slot);
    }
    return sim.state.tick;
  }

  sendEmote(kind: EmoteKind): void {
    this.transport?.send(JSON.stringify({ type: 'emote', kind }));
  }

  /** Inputs for one predicted tick: own slot real, remotes unknown (null). */
  private predictionInputs(ownBits: number): (number | null)[] {
    const inputs: (number | null)[] = [null, null, null, null];
    if (!this.spectator && this.slot >= 0) inputs[this.slot] = ownBits;
    return inputs;
  }

  private handleMessage(data: string): void {
    const msg = parseServerMsg(data);
    if (!msg) return;
    switch (msg.type) {
      case 'welcome': {
        this.slot = msg.slot;
        this.spectator = msg.spectator;
        if (msg.rejoinToken) this.rejoinToken = msg.rejoinToken;
        const sim = this.opts.createSim();
        sim.restore(msg.snapshot);
        this.predicted = sim;
        this.snapPrev = null;
        this.snapLatest = { tick: msg.tick, state: msg.snapshot };
        this.ownInputs.clear();
        this.hashAtTick.clear();
        this.lastSentBits = -1; // force a fresh input send after (re)connect
        this.ticksSinceInputSend = 0;
        this.inputTick = msg.tick + MIN_LEAD;
        for (let i = 0; i < MIN_LEAD; i++) sim.tick(this.predictionInputs(0));
        this.setStatus('active');
        break;
      }
      case 'snapshot':
        this.applySnapshot(msg.tick, msg.state);
        break;
      case 'hashcheck': {
        const local = this.hashAtTick.get(msg.tick);
        if (local !== undefined && local !== msg.hash) {
          this.desyncs.push({ tick: msg.tick, serverHash: msg.hash, localHash: local });
          this.opts.onEvent?.({ kind: 'desync', tick: msg.tick });
          this.transport?.send(JSON.stringify({ type: 'resync' }));
        }
        break;
      }
      case 'pong':
        this.rttMs = Math.max(1, this.now() - msg.t);
        break;
      case 'peerMeta':
        this.peers = msg.slots;
        this.spectators = msg.spectators;
        this.opts.onEvent?.({ kind: 'peers', slots: msg.slots, spectators: msg.spectators });
        break;
      case 'emote':
        if (this.predicted) {
          this.emotes.set(msg.slot, {
            kind: msg.kind,
            untilTick: this.predicted.state.tick + EMOTE_DISPLAY_TICKS,
          });
        }
        break;
      case 'levelEvent':
        this.opts.onEvent?.({ kind: 'levelEvent', event: msg.kind });
        break;
      case 'error':
        if (msg.code === 'room_full') this.setStatus('full');
        this.opts.onEvent?.({ kind: 'error', code: msg.code, message: msg.message });
        break;
    }
  }

  /** Rebase: restore server truth, replay buffered local inputs on top. */
  private applySnapshot(tick: number, state: string): void {
    const sim = this.predicted;
    if (!sim) return;
    if (this.snapLatest && tick <= this.snapLatest.tick) return; // stale/dup
    this.snapPrev = this.snapLatest;
    this.snapLatest = { tick, state };

    sim.restore(state);
    if (tick % HASHCHECK_EVERY === 0) {
      this.hashAtTick.set(tick, sim.hash());
      for (const t of this.hashAtTick.keys()) {
        if (t <= tick - 3 * HASHCHECK_EVERY) this.hashAtTick.delete(t);
      }
    }
    for (const t of this.ownInputs.keys()) {
      if (t <= tick) this.ownInputs.delete(t);
    }
    // Replay our own inputs from the snapshot up to the current input tick.
    for (let t = tick; t < this.inputTick; t++) {
      sim.tick(this.predictionInputs(this.ownInputs.get(t) ?? 0));
    }

    // Steer the input clock toward serverTick + lead (smoothly; snap if far).
    const desiredLead = Math.min(
      Math.max(Math.ceil(this.rttMs / 2 / (1000 / 60)) + 2, MIN_LEAD),
      MAX_LEAD,
    );
    const lead = this.inputTick - tick;
    const drift = lead - desiredLead;
    if (Math.abs(drift) > MAX_LEAD) {
      this.inputTick = tick + desiredLead;
      this.tickAdjust = 0;
    } else if (drift > 2 || drift < -2) {
      this.tickAdjust = Math.sign(drift) * Math.min(Math.abs(drift) - 2, 8);
    }
  }

  private setStatus(s: RoomClientStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.opts.onEvent?.({ kind: 'status', status: s });
  }
}
