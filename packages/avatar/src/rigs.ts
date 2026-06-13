/**
 * Placeholder body rigs (ADR-004 step 2). The AI generates the *identity* (a
 * head); these hand-authored frames provide the *animation*. The head is
 * composited on top of a body that bobs/steps/leans per frame.
 *
 * Everything here is deliberately swappable: this is the one file the Phase 3
 * "real art" pass (step 5) replaces with proper pixel art. The compositor
 * (`sprite.ts`) only depends on the exported shapes (`FRAMES`, `POSES`,
 * `SPRITE_SIZE`, `HEAD_SLOT`, `HEAD_ANCHOR`), not on how the bodies are drawn —
 * so better rigs drop in without touching the compositor, renderer, or tests
 * that assert on the manifest.
 *
 * Conventions:
 *  - Every frame is a SPRITE_SIZE×SPRITE_SIZE grid of PALETTE_P1 indices
 *    (0 = transparent), row-major. Bodies are drawn FACING RIGHT; the renderer
 *    mirrors horizontally for left-facing (so we author one direction).
 *  - The head occupies a HEAD_SLOT×HEAD_SLOT box at HEAD_ANCHOR, nudged per
 *    frame by `headDx/headDy`. The body is drawn first; the head overlays it,
 *    so the torso top tucks behind the (big, chibi) head and only limbs show.
 */

/** On-screen character sprite cell, in logical pixels (SPEC §player: 16×16). */
export const SPRITE_SIZE = 16;

/** Edge of the head box inside the cell. A clean 2:1 downscale of the stored
 *  24×24 head, big enough to read a face, small enough to leave room for a
 *  body and feet (this is a chibi: the head is most of the silhouette). */
export const HEAD_SLOT = 12;

/** Top-left of the head box within the cell. Centered horizontally (2px each
 *  side); 1px from the top so a hair/ear pixel never clips the cell edge. */
export const HEAD_ANCHOR = { x: 2, y: 1 } as const;

/** A pose: a named, contiguous run of frames in the sheet with playback hints
 *  the renderer uses (it never hardcodes frame indices — it reads this). */
export interface Pose {
  /** First frame index in the sheet. */
  readonly start: number;
  /** Number of frames. */
  readonly count: number;
  /** Frames per second at the sim's 60Hz; the renderer derives the frame from
   *  the tick. Animation is cosmetic only — never feeds the sim. */
  readonly fps: number;
  /** Loop (idle/walk/rescue) vs. pick-by-state (jump/blow). */
  readonly loop: boolean;
}

/** One sheet frame: a body grid plus where the head sits this frame. */
export interface Frame {
  readonly pose: PoseName;
  /** SPRITE_SIZE² PALETTE_P1 indices (the body, head not yet composited). */
  readonly body: Uint8Array;
  /** Head nudge from HEAD_ANCHOR, in logical pixels. */
  readonly headDx: number;
  readonly headDy: number;
}

export type PoseName = 'idle' | 'walk' | 'jump' | 'blow' | 'rescue';

// --- tiny pixel-art DSL over a 16×16 index grid ------------------------------

const OUTLINE = 1; //  midnight — silhouette outline
const BODY = 4; //  phosphor mint — torso fill
const BODY_SHADE = 3; //  mint shadow — belly/underside
const FOOT = 2; //  deep navy — feet

const grid = (): Uint8Array => new Uint8Array(SPRITE_SIZE * SPRITE_SIZE);

const set = (g: Uint8Array, x: number, y: number, c: number): void => {
  if (x >= 0 && x < SPRITE_SIZE && y >= 0 && y < SPRITE_SIZE) g[y * SPRITE_SIZE + x] = c;
};

const fill = (g: Uint8Array, x: number, y: number, w: number, h: number, c: number): void => {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) set(g, xx, yy, c);
};

/**
 * The shared body: a small rounded torso low in the cell with two feet and two
 * stubby arms. `legLift` raises one foot for the walk cycle (which side is set
 * by `swap`); `armsForward` pushes the arms ahead for the blow pose; `dy`
 * shifts the whole body for jump/squish poses.
 */
function drawBody(opts: {
  leftLift?: number;
  rightLift?: number;
  armsForward?: boolean;
  dy?: number;
  narrow?: boolean;
}): Uint8Array {
  const g = grid();
  const dy = opts.dy ?? 0;
  const inset = opts.narrow ? 1 : 0;

  // Torso: rows 10..14, 8px wide, centered. Outline at the base + sides.
  const tx = 4 + inset;
  const tw = 8 - inset * 2;
  const top = 10 + dy;
  fill(g, tx, top, tw, 4, BODY);
  fill(g, tx, top + 3, tw, 1, BODY_SHADE); // belly shade
  // round the torso shoulders
  set(g, tx, top, OUTLINE);
  set(g, tx + tw - 1, top, OUTLINE);
  // outline down the sides + across the base
  for (let y = top; y < top + 4; y++) {
    set(g, tx - 1, y, OUTLINE);
    set(g, tx + tw, y, OUTLINE);
  }
  fill(g, tx - 1, top + 4, tw + 2, 1, OUTLINE);

  // Feet: two 2px feet under the torso, each liftable for the walk cycle.
  const footY = top + 4;
  const lY = footY - (opts.leftLift ?? 0);
  const rY = footY - (opts.rightLift ?? 0);
  fill(g, tx + 1, lY, 2, 2, FOOT);
  fill(g, tx + tw - 3, rY, 2, 2, FOOT);

  // Arms: stubs at the torso sides, or reaching forward (right) to "blow".
  if (opts.armsForward) {
    fill(g, tx + tw, top + 1, 2, 1, BODY); // right arm forward
    set(g, tx + tw + 2, top + 1, OUTLINE);
    set(g, tx - 1, top + 1, BODY); // left arm tucked
  } else {
    set(g, tx - 1, top + 1, BODY);
    set(g, tx + tw, top + 1, BODY);
  }
  return g;
}

// --- the 12 frames, in sheet order -------------------------------------------

const frame = (pose: PoseName, body: Uint8Array, headDx = 0, headDy = 0): Frame => ({
  pose,
  body,
  headDx,
  headDy,
});

/** Frames in sheet layout order. POSES indexes into this; keep them in sync. */
export const FRAMES: readonly Frame[] = [
  // idle ×2 — gentle 1px head bob, feet planted.
  frame('idle', drawBody({}), 0, 0),
  frame('idle', drawBody({}), 0, 1),
  // walk ×4 — alternating feet, head bobs with the stride.
  frame('walk', drawBody({ leftLift: 1 }), 0, 0),
  frame('walk', drawBody({}), 0, 1),
  frame('walk', drawBody({ rightLift: 1 }), 0, 0),
  frame('walk', drawBody({}), 0, 1),
  // jump ×2 — frame 0 ascend (feet tucked), frame 1 descend (feet split).
  frame('jump', drawBody({ leftLift: 1, rightLift: 1, dy: -1 }), 0, -1),
  frame('jump', drawBody({ dy: 1 }), 0, 1),
  // blow ×2 — lean into it, arms forward, head nudged toward the bubble.
  frame('blow', drawBody({ armsForward: true }), 1, 0),
  frame('blow', drawBody({ armsForward: true }), 1, 1),
  // rescue ×2 — squished small inside the rescue bubble, drifting.
  frame('rescue', drawBody({ narrow: true, dy: 1 }), 0, 1),
  frame('rescue', drawBody({ narrow: true, dy: 1 }), 0, 0),
];

/** Pose manifest — the renderer reads these ranges; never hardcodes indices. */
export const POSES: Readonly<Record<PoseName, Pose>> = {
  idle: { start: 0, count: 2, fps: 2, loop: true },
  walk: { start: 2, count: 4, fps: 8, loop: true },
  jump: { start: 6, count: 2, fps: 1, loop: false },
  blow: { start: 8, count: 2, fps: 8, loop: false },
  rescue: { start: 10, count: 2, fps: 3, loop: true },
};
