/**
 * Minimal touch pad (stopgap until the full Phase 1.5 mobile pass): DOM
 * buttons feeding the same input bitmask as the keyboard. ◀ ▶ on the left,
 * A (jump) and B (blow / hold for emotes) on the right. Hidden on devices
 * without coarse pointers.
 */
import { Button } from '@retro-recall/retrokit/sim';

export interface TouchPad {
  sample(): number;
  /** The B button element (the emote wheel anchors its hold gesture here). */
  bButton: HTMLButtonElement;
  root: HTMLElement;
}

export const hasTouch = (): boolean =>
  window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export function createTouchPad(parent: HTMLElement): TouchPad {
  let bits = 0;
  const root = document.createElement('div');
  root.className = 'touchpad';

  const make = (label: string, bit: number, cls: string): HTMLButtonElement => {
    const el = document.createElement('button');
    el.textContent = label;
    el.className = `tbtn ${cls}`;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    const down = (e: PointerEvent): void => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      bits |= bit;
      el.classList.add('held');
    };
    const up = (): void => {
      bits &= ~bit;
      el.classList.remove('held');
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    return el;
  };

  const left = document.createElement('div');
  left.className = 'tcluster';
  left.append(make('◀', Button.Left, 'dir'), make('▶', Button.Right, 'dir'));
  const right = document.createElement('div');
  right.className = 'tcluster';
  const b = make('B', Button.B, 'act b');
  right.append(b, make('A', Button.A, 'act a'));
  root.append(left, right);
  parent.append(root);

  return { sample: () => bits, bButton: b, root };
}
