/**
 * Touch controls (ADR-007, replaces the Phase 2 stopgap pad). Two zones the
 * layout engine positions — d-pad and A/B — feed the same NES-style input
 * bitmask the keyboard does; the sim never knows fingers exist.
 *
 * - The *whole zone* is the touch surface; the drawn pad is just the visual.
 * - D-pad: 8-way from the vector to the cross center, recomputed every
 *   pointermove — slide between directions without lifting.
 * - A/B: each pointer locks to the button it pressed (≥48px visuals plus hit
 *   slop via nearest-center matching), so a B-hold can't wander onto A while
 *   the emote wheel is open.
 * - Every pointer is tracked by pointerId: move + jump + blow simultaneously.
 */
import { Button } from '@retro-recall/retrokit/sim';

export interface TouchControls {
  /** Combined bitmask of everything currently held. */
  sample(): number;
  destroy(): void;
}

export interface TouchControlHooks {
  /** B pressed/released — the emote wheel hangs its hold gesture here. */
  onB?: (down: boolean) => void;
}

/** Octant → bits, starting at East, clockwise (screen y grows downward). */
const OCTANT_BITS: readonly number[] = [
  Button.Right,
  Button.Right | Button.Down,
  Button.Down,
  Button.Down | Button.Left,
  Button.Left,
  Button.Left | Button.Up,
  Button.Up,
  Button.Up | Button.Right,
];

const ARM_NAMES = ['up', 'right', 'down', 'left'] as const;
const ARM_BITS = [Button.Up, Button.Right, Button.Down, Button.Left] as const;

/** Extra touchable radius beyond a button's drawn edge. */
const HIT_SLOP = 18;

const suppressGestures = (el: HTMLElement): void => {
  el.style.touchAction = 'none';
  el.addEventListener('contextmenu', (e) => e.preventDefault());
};

export function createTouchControls(
  dpadZone: HTMLElement,
  buttonZone: HTMLElement,
  hooks: TouchControlHooks = {},
): TouchControls {
  // --- D-pad ---
  const dpad = document.createElement('div');
  dpad.className = 'dpad';
  const arms = ARM_NAMES.map((name) => {
    const arm = document.createElement('div');
    arm.className = `dpad-arm ${name}`;
    return arm;
  });
  const hub = document.createElement('div');
  hub.className = 'dpad-hub';
  dpad.append(...arms, hub);
  dpadZone.append(dpad);
  suppressGestures(dpadZone);

  const dpadPointers = new Map<number, number>();
  let dpadBits = 0;

  const refreshDpad = (): void => {
    dpadBits = 0;
    for (const bits of dpadPointers.values()) dpadBits |= bits;
    arms.forEach((arm, i) => arm.classList.toggle('held', (dpadBits & ARM_BITS[i]!) !== 0));
  };

  const dpadVector = (e: PointerEvent): number => {
    const r = dpad.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const dead = Math.max(10, r.width * 0.12);
    if (Math.hypot(dx, dy) < dead) return 0;
    const octant = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
    return OCTANT_BITS[octant]!;
  };

  const onDpadDown = (e: PointerEvent): void => {
    e.preventDefault();
    dpadZone.setPointerCapture(e.pointerId);
    dpadPointers.set(e.pointerId, dpadVector(e));
    refreshDpad();
  };
  const onDpadMove = (e: PointerEvent): void => {
    if (!dpadPointers.has(e.pointerId)) return;
    dpadPointers.set(e.pointerId, dpadVector(e));
    refreshDpad();
  };
  const onDpadUp = (e: PointerEvent): void => {
    if (!dpadPointers.delete(e.pointerId)) return;
    refreshDpad();
  };
  dpadZone.addEventListener('pointerdown', onDpadDown);
  dpadZone.addEventListener('pointermove', onDpadMove);
  dpadZone.addEventListener('pointerup', onDpadUp);
  dpadZone.addEventListener('pointercancel', onDpadUp);

  // --- A / B buttons ---
  const makeButton = (label: string, cls: string): HTMLDivElement => {
    const el = document.createElement('div');
    el.className = `pad-btn ${cls}`;
    el.textContent = label;
    return el;
  };
  const cluster = document.createElement('div');
  cluster.className = 'btn-cluster';
  const bEl = makeButton('B', 'b');
  const aEl = makeButton('A', 'a');
  cluster.append(bEl, aEl);
  buttonZone.append(cluster);
  suppressGestures(buttonZone);

  const buttons = [
    { el: aEl, bit: Button.A as number },
    { el: bEl, bit: Button.B as number },
  ];
  const btnPointers = new Map<number, { el: HTMLDivElement; bit: number }>();
  let buttonBits = 0;

  const hitTest = (e: PointerEvent): (typeof buttons)[number] | null => {
    let best: (typeof buttons)[number] | null = null;
    let bestDist = Infinity;
    for (const b of buttons) {
      const r = b.el.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (d <= r.width / 2 + HIT_SLOP && d < bestDist) {
        best = b;
        bestDist = d;
      }
    }
    return best;
  };

  const refreshButtons = (): void => {
    buttonBits = 0;
    for (const held of btnPointers.values()) buttonBits |= held.bit;
    for (const b of buttons) {
      const held = [...btnPointers.values()].some((h) => h.el === b.el);
      b.el.classList.toggle('held', held);
    }
  };

  const onBtnDown = (e: PointerEvent): void => {
    e.preventDefault();
    const hit = hitTest(e);
    if (!hit) return;
    buttonZone.setPointerCapture(e.pointerId);
    btnPointers.set(e.pointerId, hit);
    refreshButtons();
    if (hit.bit === Button.B) hooks.onB?.(true);
  };
  const onBtnUp = (e: PointerEvent): void => {
    const held = btnPointers.get(e.pointerId);
    if (!held) return;
    btnPointers.delete(e.pointerId);
    refreshButtons();
    if (held.bit === Button.B) hooks.onB?.(false);
  };
  buttonZone.addEventListener('pointerdown', onBtnDown);
  buttonZone.addEventListener('pointerup', onBtnUp);
  buttonZone.addEventListener('pointercancel', onBtnUp);

  // App switch / notification shade mid-press: drop everything held.
  const onBlur = (): void => {
    const bWasHeld = (buttonBits & Button.B) !== 0;
    dpadPointers.clear();
    btnPointers.clear();
    refreshDpad();
    refreshButtons();
    if (bWasHeld) hooks.onB?.(false);
  };
  window.addEventListener('blur', onBlur);

  return {
    sample: () => dpadBits | buttonBits,
    destroy: () => {
      window.removeEventListener('blur', onBlur);
      dpad.remove();
      cluster.remove();
    },
  };
}
