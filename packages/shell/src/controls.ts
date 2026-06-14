/**
 * Touch controls (ADR-007, replaces the Phase 2 stopgap pad). Two zones the
 * layout engine positions — d-pad and A/B — feed the same NES-style input
 * bitmask the keyboard does; the sim never knows fingers exist. Built on the
 * shared touch primitives (touch.ts) so the plumbing is authored once.
 *
 * - The *whole zone* is the touch surface; the drawn pad is just the visual.
 * - D-pad: 8-way from the vector to the cross center, recomputed every
 *   pointermove — slide between directions without lifting.
 * - A/B: each pointer locks to the nearest button (≥48px visuals plus hit slop),
 *   and re-evaluates on move, so sliding from B onto A hands the hold over
 *   instead of leaving B stuck (and the emote wheel jammed open).
 * - Every pointer is tracked by pointerId: move + jump + blow simultaneously.
 * - Held state is dropped on blur, pagehide, and visibilitychange — iOS does not
 *   reliably fire blur on App Switcher / notification shade.
 */
import { Button } from '@retro-recall/retrokit/sim';
import { suppressGestures } from './gestures';
import { createOctantPad, onRelease, type OctantBitset } from './touch';
import { attachIdleFade, type IdleFadeOptions } from './fade';

export interface TouchControls {
  /** Combined bitmask of everything currently held. */
  sample(): number;
  destroy(): void;
}

export interface ButtonSpec {
  label: string;
  bit: number;
  /** Extra class on the button element (styling hook). */
  className: string;
  /** Fire a hook on this button's press/release transitions. */
  onChange?: (down: boolean) => void;
}

export interface TouchControlOptions {
  /** B pressed/released — the emote wheel hangs its hold gesture here.
   *  Shorthand for a `{ bit: Button.B, onChange }` spec. */
  onB?: (down: boolean) => void;
  /** Override the action buttons (DOM order). Defaults to B then A. */
  buttons?: ButtonSpec[];
  /** Override the d-pad / stick direction mapping. Defaults to the four cardinals. */
  dpadBits?: OctantBitset;
  /** Movement control style. 'stick' = round analog-feel pad with a knob that
   *  follows the thumb (ADR-012 default); 'cross' = the classic 4-arm d-pad. */
  style?: 'stick' | 'cross';
  /** Fade the overlaid controls when idle (ADR-012). `true` for defaults. */
  fade?: boolean | IdleFadeOptions;
}

/** Backwards-compatible alias — callers used to pass `{ onB }`. */
export type TouchControlHooks = TouchControlOptions;

const ARM_NAMES = ['up', 'right', 'down', 'left'] as const;
const ARM_BITS = [Button.Up, Button.Right, Button.Down, Button.Left] as const;
const CARDINALS: OctantBitset = {
  up: Button.Up,
  down: Button.Down,
  left: Button.Left,
  right: Button.Right,
};

/** Extra touchable radius beyond a button's drawn edge. */
const HIT_SLOP = 18;

export function createTouchControls(
  dpadZone: HTMLElement,
  buttonZone: HTMLElement,
  opts: TouchControlOptions = {},
): TouchControls {
  // --- Movement: round stick (default) or classic cross d-pad ---
  const style = opts.style ?? 'stick';
  let dpad: HTMLElement;
  let pad: ReturnType<typeof createOctantPad>;
  if (style === 'stick') {
    // Round analog-feel pad: a ring with a knob that follows the thumb.
    dpad = document.createElement('div');
    dpad.className = 'stick';
    const knob = document.createElement('div');
    knob.className = 'stick-knob';
    dpad.append(knob);
    dpadZone.append(dpad);
    pad = createOctantPad(dpadZone, dpad, { bits: opts.dpadBits ?? CARDINALS, analogKnob: knob });
  } else {
    dpad = document.createElement('div');
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
    pad = createOctantPad(dpadZone, dpad, {
      bits: opts.dpadBits ?? CARDINALS,
      onChange: (bits) =>
        arms.forEach((arm, i) => arm.classList.toggle('held', (bits & ARM_BITS[i]!) !== 0)),
    });
  }

  // --- A / B buttons ---
  const specs: ButtonSpec[] = opts.buttons ?? [
    { label: 'B', bit: Button.B, className: 'b', onChange: opts.onB },
    { label: 'A', bit: Button.A, className: 'a' },
  ];
  const cluster = document.createElement('div');
  cluster.className = 'btn-cluster';
  const buttons = specs.map((spec) => {
    const el = document.createElement('div');
    el.className = `pad-btn ${spec.className}`;
    el.textContent = spec.label;
    cluster.append(el);
    return { ...spec, el };
  });
  buttonZone.append(cluster);
  suppressGestures(buttonZone);

  type Held = (typeof buttons)[number];
  // pointerId → the button it currently rests on, or null when slid off all.
  const btnPointers = new Map<number, Held | null>();
  let buttonBits = 0;
  const fired = new Map<number, boolean>(); // bit → last reported onChange state

  const hitTest = (e: PointerEvent): Held | null => {
    let best: Held | null = null;
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

  const refresh = (): void => {
    buttonBits = 0;
    for (const held of btnPointers.values()) if (held) buttonBits |= held.bit;
    for (const b of buttons) {
      const isHeld = [...btnPointers.values()].some((h) => h?.el === b.el);
      b.el.classList.toggle('held', isHeld);
      // Edge-trigger each button's onChange (covers down/up/slide/release).
      if (b.onChange) {
        const was = fired.get(b.bit) ?? false;
        if (was !== isHeld) {
          fired.set(b.bit, isHeld);
          b.onChange(isHeld);
        }
      }
    }
  };

  const onDown = (e: PointerEvent): void => {
    e.preventDefault();
    const hit = hitTest(e);
    if (!hit) return;
    btnPointers.set(e.pointerId, hit);
    try {
      buttonZone.setPointerCapture(e.pointerId);
    } catch {
      /* best-effort */
    }
    refresh();
  };
  const onMove = (e: PointerEvent): void => {
    if (!btnPointers.has(e.pointerId)) return;
    const next = hitTest(e); // may be null when slid into the gap
    if (next !== (btnPointers.get(e.pointerId) ?? null)) {
      btnPointers.set(e.pointerId, next);
      refresh();
    }
  };
  const onUp = (e: PointerEvent): void => {
    if (btnPointers.delete(e.pointerId)) refresh();
  };
  buttonZone.addEventListener('pointerdown', onDown);
  buttonZone.addEventListener('pointermove', onMove);
  buttonZone.addEventListener('pointerup', onUp);
  buttonZone.addEventListener('pointercancel', onUp);

  const releaseAll = (): void => {
    if (btnPointers.size === 0) return;
    btnPointers.clear();
    refresh();
  };
  const stopRelease = onRelease(releaseAll);

  // Idle-fade the overlaid controls so the map shows through (ADR-012).
  const stopFade = opts.fade
    ? attachIdleFade([dpadZone, buttonZone], opts.fade === true ? {} : opts.fade)
    : null;

  return {
    sample: () => pad.sample() | buttonBits,
    destroy: () => {
      stopRelease();
      stopFade?.();
      pad.destroy();
      buttonZone.removeEventListener('pointerdown', onDown);
      buttonZone.removeEventListener('pointermove', onMove);
      buttonZone.removeEventListener('pointerup', onUp);
      buttonZone.removeEventListener('pointercancel', onUp);
      dpad.remove();
      cluster.remove();
    },
  };
}
