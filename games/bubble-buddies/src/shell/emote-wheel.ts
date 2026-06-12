/**
 * Emote wheel (ADR-008 Tier 1): hold B (keyboard X, or the touch B button)
 * for 400 ms to open a radial of the six fixed emotes; slide/arrow to one
 * and release to send. Fixed enum only — no free text anywhere, ever.
 */
import { EMOTE_KINDS, type EmoteKind } from '@retro-recall/netcode';

export const EMOTE_GLYPHS: Record<EmoteKind, string> = {
  help: 'HELP!',
  over_here: 'HERE!',
  nice: 'NICE!',
  uh_oh: 'UH-OH',
  laugh: 'HAHA',
  heart: '♥',
};

const HOLD_MS = 400;
const RADIUS = 86;

export class EmoteWheel {
  private readonly root: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly onSend: (kind: EmoteKind) => void;
  private holdTimer: number | null = null;
  private open = false;
  private highlighted = -1;

  constructor(parent: HTMLElement, onSend: (kind: EmoteKind) => void) {
    this.onSend = onSend;
    this.root = document.createElement('div');
    this.root.className = 'emote-wheel hidden';
    EMOTE_KINDS.forEach((kind, i) => {
      const btn = document.createElement('button');
      btn.className = 'emote-option';
      btn.textContent = EMOTE_GLYPHS[kind];
      const angle = (i / EMOTE_KINDS.length) * Math.PI * 2 - Math.PI / 2;
      btn.style.left = `calc(50% + ${Math.round(Math.cos(angle) * RADIUS)}px)`;
      btn.style.top = `calc(50% + ${Math.round(Math.sin(angle) * RADIUS)}px)`;
      btn.addEventListener('pointerenter', () => this.highlight(i));
      btn.addEventListener('pointerup', () => this.send(i));
      this.buttons.push(btn);
      this.root.append(btn);
    });
    const hint = document.createElement('div');
    hint.className = 'emote-hint';
    hint.textContent = 'release to send';
    this.root.append(hint);
    parent.append(this.root);

    // Track the pointer/finger while the wheel is open (touch B-hold drag).
    window.addEventListener('pointermove', (e) => {
      if (this.open) this.highlightNearest(e.clientX, e.clientY);
    });
    window.addEventListener('pointerup', () => {
      if (this.open) this.release();
    });
  }

  /** Call on B down (keyboard or touch). */
  holdStart(): void {
    if (this.holdTimer !== null || this.open) return;
    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = null;
      this.show();
    }, HOLD_MS);
  }

  /** Call on B up: sends the highlighted emote if the wheel is open. */
  release(): void {
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    if (this.open) this.send(this.highlighted);
  }

  /** Keyboard navigation while open (arrow keys step around the wheel). */
  step(dir: 1 | -1): void {
    if (!this.open) return;
    const n = EMOTE_KINDS.length;
    this.highlight(((this.highlighted < 0 ? 0 : this.highlighted + dir) + n) % n);
  }

  get isOpen(): boolean {
    return this.open;
  }

  cancel(): void {
    this.hide();
  }

  private show(): void {
    this.open = true;
    this.highlighted = -1;
    this.root.classList.remove('hidden');
  }

  private hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
    this.buttons.forEach((b) => b.classList.remove('hot'));
  }

  private highlight(i: number): void {
    this.highlighted = i;
    this.buttons.forEach((b, j) => b.classList.toggle('hot', j === i));
  }

  private highlightNearest(x: number, y: number): void {
    const rect = this.root.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (Math.hypot(x - cx, y - cy) < 24) {
      this.highlight(-1);
      return;
    }
    const angle = Math.atan2(y - cy, x - cx) + Math.PI / 2;
    const n = EMOTE_KINDS.length;
    const idx = (Math.round((angle / (Math.PI * 2)) * n) + n) % n;
    this.highlight(idx);
  }

  private send(i: number): void {
    if (i >= 0) this.onSend(EMOTE_KINDS[i]!);
    this.hide();
  }
}
