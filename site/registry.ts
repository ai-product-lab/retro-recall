/**
 * Game registry — the arcade's single source of truth.
 *
 * One entry per game drives the library home (tiles, status, routes), the
 * coming-soon teasers, and (later) the new-game scaffolder's registry insert.
 * Adding a game = adding an entry here. Taglines/twists are drawn from each
 * game's BRIEF so the teaser copy and the tile stay in sync.
 */

export type GameStatus = 'live' | 'coming-soon';
export type GameMode = 'co-op' | 'versus' | 'race';

export interface GameEntry {
  /** Stable id; matches games/<id>/ and the play route. */
  id: string;
  name: string;
  /** One-line hook shown on the tile. */
  tagline: string;
  /** Human player range, e.g. "1–4". */
  players: string;
  mode: GameMode;
  status: GameStatus;
  /** Play route — present only when live. */
  route?: string;
  /** Per-game accent from the BRAND palette. */
  accent: string;
  /** Placeholder pixel-art glyph id (see src/art.ts). */
  art: string;
  /** Teaser shown when a coming-soon tile is peeked (from the BRIEF). */
  teaser: {
    /** The "twist vs. the source" pitch, family-framed. */
    twist: string;
    /** A couple of flavor bullets. */
    notes: string[];
  };
}

// Palette (branding/BRAND.md): Bubble #4CC9F0, Star #FFD166, Phosphor #3DF5A6,
// Cabinet #FF6B6B.
export const GAMES: readonly GameEntry[] = [
  {
    id: 'bubble-buddies',
    name: 'Bubble Buddies',
    tagline: 'Trap the grumbles, pop with a pal.',
    players: '1–4',
    mode: 'co-op',
    status: 'live',
    route: '/play/bubble-buddies/',
    accent: '#4cc9f0',
    art: 'bubbles',
    teaser: {
      twist: 'Co-op bubble-popping where your buddies become the characters.',
      notes: ['Blow bubbles, trap the grumbles, pop them together for chains.', 'Downed? A teammate pops your rescue bubble.'],
    },
  },
  {
    id: 'puck-pals',
    name: 'Puck Pals',
    tagline: 'Backyard rink, family rivalry.',
    players: '1–4',
    mode: 'versus',
    status: 'live',
    route: '/play/puck-pals/',
    accent: '#ffd166',
    art: 'puck',
    teaser: {
      twist: 'Arcade hockey on a tight rink — exaggerated ice slides and a charged "super slap" with a wind-up tell so kids can dodge it.',
      notes: ['1v1 to 2v2 online; empty slots filled by CPU skaters.', 'No fighting — body checks just send players comically sliding.'],
    },
  },
  {
    id: 'splash-squad',
    name: 'Splash Squad',
    tagline: 'Water blasters vs. wind-up robots.',
    players: '1–4',
    mode: 'co-op',
    status: 'coming-soon',
    accent: '#3df5a6',
    art: 'droplet',
    teaser: {
      twist: 'Side-scrolling co-op soak-’em-up: douse splat-bots, grab nozzle power-ups, combine streams for a bigger splash.',
      notes: ['Zero violence — robots wind down with comic sputters.', 'Buddy-revive rescue bubbles, shared with Bubble Buddies.'],
    },
  },
  {
    id: 'ramp-riders',
    name: 'Ramp Riders',
    tagline: 'Backyard BMX, one more race.',
    players: '1–4',
    mode: 'race',
    status: 'live',
    route: '/play/ramp-riders/',
    accent: '#ff6b6b',
    art: 'wheel',
    teaser: {
      twist: 'Pump for speed, pre-jump and lean, land clean to keep momentum over dirt ramps and sprinklers. Short races so "one more!" always wins.',
      notes: ['Riders pass through each other — no collision griefing.', 'A track editor is the headline later phase.'],
    },
  },
  // <scaffold:registry> — `pnpm new-game` inserts new game entries above this line.
];

/** The lone entry, by id. */
export function gameById(id: string): GameEntry | undefined {
  return GAMES.find((g) => g.id === id);
}

/**
 * Join URL for a known game id + room code, or null if that game isn't live.
 * Used once the rooms server tells us which game a code belongs to (the home
 * "join by code" flow does a `/api/rooms/<code>` lookup now that >1 game ships).
 */
export function joinRouteForGame(gameId: string, code: string): string | null {
  const g = gameById(gameId);
  if (g?.status !== 'live' || !g.route) return null;
  return `${g.route}?room=${encodeURIComponent(code)}`;
}

/**
 * Offline fallback when the server lookup is unavailable: route to a live game.
 * Unambiguous only while exactly one game is live; with several, the server hop
 * in `joinRouteForGame` is the source of truth.
 */
export function resolveJoinRoute(code: string): string | null {
  const live = GAMES.filter((g) => g.status === 'live' && g.route);
  if (live.length !== 1) return null;
  return `${live[0]!.route}?room=${encodeURIComponent(code)}`;
}
