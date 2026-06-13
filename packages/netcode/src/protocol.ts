/**
 * Wire protocol v1 (JSON; see packages/netcode/SPEC.md). Binary only if
 * measured necessary. Every message is one JSON object with a `type` field.
 */

// --- Tuning constants (from the spec) ---

/** Full snapshot broadcast every N sim ticks (3 → 20 Hz at 60 Hz sim). */
export const SNAPSHOT_EVERY = 3;
/** State-hash broadcast every N sim ticks (desync detection). */
export const HASHCHECK_EVERY = 600;
/**
 * Input is sent only when the pad state changes (see room-client), so a still
 * player streams nothing. This is the floor: re-send the current bits at least
 * every N ticks (~0.5 s) as a keepalive — it re-establishes the server's held
 * input after a rare DO eviction, and proves liveness so the room can drop
 * genuinely-gone tabs without dropping a player who's simply holding a button.
 */
export const INPUT_KEEPALIVE_TICKS = 30;
/** Server-side emote rate limit: one per N ticks per player. */
export const EMOTE_RATE_TICKS = 30;
/** Shell-side: how long an emote speech bubble stays up. */
export const EMOTE_DISPLAY_TICKS = 120;
/** A disconnected slot stays reserved for its rejoin token this long. */
export const REJOIN_WINDOW_S = 600;
/** Room codes expire this long after last activity. */
export const ROOM_TTL_S = 24 * 60 * 60;
export const MAX_PLAYERS = 4;
export const MAX_SPECTATORS = 4;

/** Unambiguous A–Z subset (no I/O/Q) for 4-letter room codes. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 4;

export const isRoomCode = (s: string): boolean =>
  s.length === ROOM_CODE_LENGTH && [...s].every((c) => ROOM_CODE_ALPHABET.includes(c));

/** Build a room code from a random source (`random()` ∈ [0,1)). */
export const makeRoomCode = (random: () => number): string =>
  Array.from(
    { length: ROOM_CODE_LENGTH },
    () => ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)]!,
  ).join('');

// --- Emotes (ADR-008 Tier 1: fixed enum, no free text ever) ---

export const EMOTE_KINDS = ['help', 'over_here', 'nice', 'uh_oh', 'laugh', 'heart'] as const;
export type EmoteKind = (typeof EMOTE_KINDS)[number];
export const isEmoteKind = (s: unknown): s is EmoteKind =>
  typeof s === 'string' && (EMOTE_KINDS as readonly string[]).includes(s);

// --- Client → server ---

export interface JoinMsg {
  type: 'join';
  playerName: string;
  avatarId?: string;
  rejoinToken?: string;
}

export interface InputMsg {
  type: 'input';
  /** Client's predicted server tick for this input. */
  tick: number;
  bits: number;
  /**
   * Optional redundant bitmasks for ticks tick-1, tick-2, tick-3. Unnecessary
   * on a reliable ordered WebSocket (the server holds the last input across
   * gap ticks), so the current client omits it; honored if a client sends it.
   */
  prev?: number[];
}

export interface EmoteMsg {
  type: 'emote';
  kind: EmoteKind;
}

export interface PingMsg {
  type: 'ping';
  t: number;
}

/** Request a fresh snapshot (sent after a hashcheck mismatch). */
export interface ResyncMsg {
  type: 'resync';
}

export type ClientMsg = JoinMsg | InputMsg | EmoteMsg | PingMsg | ResyncMsg;

// --- Server → client ---

export interface PeerSlotMeta {
  slot: number;
  name: string;
  connected: boolean;
  /** Avatar to render for this slot; absent → slot-colored placeholder. */
  avatarId?: string;
}

export interface WelcomeMsg {
  type: 'welcome';
  /** Assigned player slot, or -1 when joining as a spectator. */
  slot: number;
  spectator: boolean;
  rejoinToken: string;
  /** Current server tick and the full state at that tick. */
  tick: number;
  snapshot: string;
}

export interface SnapshotMsg {
  type: 'snapshot';
  tick: number;
  state: string;
}

export interface PeerMetaMsg {
  type: 'peerMeta';
  slots: (PeerSlotMeta | null)[];
  spectators: number;
}

export interface EmoteEventMsg {
  type: 'emote';
  slot: number;
  kind: EmoteKind;
}

export interface HashcheckMsg {
  type: 'hashcheck';
  tick: number;
  hash: number;
}

export interface PongMsg {
  type: 'pong';
  t: number;
  serverTick: number;
}

/** UI sugar only — sim state is the truth. */
export interface LevelEventMsg {
  type: 'levelEvent';
  kind: 'levelclear' | 'gameover' | 'win';
}

export interface ErrorMsg {
  type: 'error';
  code: 'room_full' | 'bad_message' | 'not_joined';
  message: string;
}

export type ServerMsg =
  | WelcomeMsg
  | SnapshotMsg
  | PeerMetaMsg
  | EmoteEventMsg
  | HashcheckMsg
  | PongMsg
  | LevelEventMsg
  | ErrorMsg;

// --- Parsing (defensive: messages come off the wire) ---

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

/** Parse + shape-check a client message; null if malformed. */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  switch (v['type']) {
    case 'join': {
      const name = v['playerName'];
      if (typeof name !== 'string' || name.length < 1 || name.length > 24) return null;
      const token = v['rejoinToken'];
      if (token !== undefined && typeof token !== 'string') return null;
      const avatarId = v['avatarId'];
      if (avatarId !== undefined && typeof avatarId !== 'string') return null;
      return { type: 'join', playerName: name, rejoinToken: token, avatarId };
    }
    case 'input': {
      const tick = v['tick'];
      const bits = v['bits'];
      const prev = v['prev'];
      if (typeof tick !== 'number' || !Number.isInteger(tick) || tick < 0) return null;
      if (typeof bits !== 'number' || !Number.isInteger(bits)) return null;
      if (prev === undefined) return { type: 'input', tick, bits };
      if (!Array.isArray(prev) || prev.length > 3 || prev.some((b) => typeof b !== 'number')) {
        return null;
      }
      return { type: 'input', tick, bits, prev: prev as number[] };
    }
    case 'emote':
      return isEmoteKind(v['kind']) ? { type: 'emote', kind: v['kind'] } : null;
    case 'ping':
      return typeof v['t'] === 'number' ? { type: 'ping', t: v['t'] } : null;
    case 'resync':
      return { type: 'resync' };
    default:
      return null;
  }
}

/** Parse a server message on the client; null if malformed. */
export function parseServerMsg(raw: unknown): ServerMsg | null {
  if (typeof raw !== 'string') return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || typeof v['type'] !== 'string') return null;
  return v as unknown as ServerMsg; // server is trusted; clients just need shape
}
