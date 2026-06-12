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
export class KeyboardInput {
  private bits = 0;
  private readonly keymap: Readonly<Record<string, number>>;
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const bit = this.keymap[e.code];
    if (bit !== undefined) {
      this.bits |= bit;
      e.preventDefault();
    }
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const bit = this.keymap[e.code];
    if (bit !== undefined) {
      this.bits &= ~bit;
      e.preventDefault();
    }
  };

  constructor(target: Window, keymap: Readonly<Record<string, number>> = DEFAULT_KEYMAP) {
    this.keymap = keymap;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    // Avoid stuck keys when the tab loses focus mid-press.
    target.addEventListener('blur', () => {
      this.bits = 0;
    });
  }

  sample(): InputBits {
    return this.bits;
  }
}
