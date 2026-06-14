import { Button, type InputBits } from '../sim/types';

/** Default NES-style keyboard mapping (KeyboardEvent.code → button bit). */
export const DEFAULT_KEYMAP: Readonly<Record<string, number>> = {
  ArrowLeft: Button.Left,
  ArrowRight: Button.Right,
  ArrowUp: Button.Up,
  ArrowDown: Button.Down,
  KeyZ: Button.A,
  Space: Button.A,
  KeyX: Button.B,
  Enter: Button.Start,
};

/**
 * Tracks held keys and exposes the current pad state as an InputBits mask.
 * The game loop calls sample() exactly once per tick; the sim never touches
 * the DOM event stream.
 */
/** True when the key event targets an editable field (don't steal Space/arrows
 *  while the player is typing a room code / name). */
const isEditable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  );
};

export class KeyboardInput {
  private bits = 0;
  private readonly keymap: Readonly<Record<string, number>>;
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isEditable(e.target)) return;
    const bit = this.keymap[e.code];
    if (bit !== undefined) {
      this.bits |= bit;
      e.preventDefault();
    }
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (isEditable(e.target)) return;
    const bit = this.keymap[e.code];
    if (bit !== undefined) {
      this.bits &= ~bit;
      e.preventDefault();
    }
  };
  private readonly release = (): void => {
    this.bits = 0;
  };
  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.release();
  };

  constructor(target: Window, keymap: Readonly<Record<string, number>> = DEFAULT_KEYMAP) {
    this.keymap = keymap;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    // Avoid stuck keys when focus/visibility is lost mid-press. iOS does not
    // reliably fire blur on backgrounding — visibilitychange/pagehide do.
    target.addEventListener('blur', this.release);
    target.addEventListener('pagehide', this.release);
    target.document?.addEventListener('visibilitychange', this.onVisibility);
  }

  sample(): InputBits {
    return this.bits;
  }
}
