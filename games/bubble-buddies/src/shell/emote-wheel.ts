/**
 * Emote wheel (ADR-008 Tier 1): hold B (keyboard X, or the touch B button)
 * for 400 ms to open a radial of the six fixed emotes; slide/arrow to one
 * and release to send. Fixed enum only — no free text anywhere, ever.
 *
 * On touch the wheel opens centered on the finger that's holding B (clamped to
 * stay fully on-screen), so the radial drag is a short flick from the thumb
 * rather than a reach to screen-center. Keyboard X-hold falls back to center.
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

/** Spoken labels for screen readers (glyphs alone announce poorly). */
const EMOTE_NAMES: Record<EmoteKind, string> = {
  help: 'Help',
  over_here: 'Over here',
  nice: 'Nice',
  uh_oh: 'Uh oh',
  laugh: 'Laugh',
  heart: 'Heart',
};

const HOLD_MS = 400;
const RADIUS = 86;
/** Keep the whole ring on-screen around the open point. */
const EDGE_MARGIN = RADIUS + 28;
const DEAD_RADIUS = 24;

export class EmoteWheel {
  private readonly root: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly onSend: (kind: EmoteKind) => void;
  private holdTimer: number | null = null;
  private open = false;
  private highlighted = -1;
  // Last pointerdown location + the resolved wheel center while open.
  private lastPointerX = 0;
  private lastPointerY = 0;
  private havePointer = false;
  private fromPointer = false;
  private cx = 0;
  private cy = 0;

  private readonly onWindowPointerDown = (e: PointerEvent): void => {
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.havePointer = true;
  };
  private readonly onWindowPointerMove = (e: PointerEvent): void => {
    if (this.open) this.highlightNearest(e.clientX, e.clientY);
  };
  private readonly onWindowPointerUp = (): void => {
    if (this.open) this.release();
  };

  constructor(parent: HTMLElement, onSend: (kind: EmoteKind) => void) {
    this.onSend = onSend;
    this.root = document.createElement('div');
    this.root.className = 'emote-wheel hidden';
    EMOTE_KINDS.forEach((kind, i) => {
      const btn = document.createElement('button');
      btn.className = 'emote-option';
      btn.textContent = EMOTE_GLYPHS[kind];
      btn.setAttribute('aria-label', EMOTE_NAMES[kind]);
      btn.addEventListener('pointerenter', () => this.highlight(i));
      btn.addEventListener('pointerup', () => this.send(i));
      this.buttons.push(btn);
      this.root.append(btn);
    });
    this.hint = document.createElement('div');
    this.hint.className = 'emote-hint';
    this.hint.textContent = 'release to send';
    this.root.append(this.hint);
    parent.append(this.root);

    // Capture phase so the position is recorded before the B-down hook fires.
    window.addEventListener('pointerdown', this.onWindowPointerDown, { capture: true });
    window.addEventListener('pointermove', this.onWindowPointerMove);
    window.addEventListener('pointerup', this.onWindowPointerUp);
  }

  /** Call on B down. `atPointer` = a touch/pointer press (open at the finger). */
  holdStart(atPointer = false): void {
    if (this.holdTimer !== null || this.open) return;
    this.fromPointer = atPointer;
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

  destroy(): void {
    if (this.holdTimer !== null) clearTimeout(this.holdTimer);
    window.removeEventListener('pointerdown', this.onWindowPointerDown, { capture: true });
    window.removeEventListener('pointermove', this.onWindowPointerMove);
    window.removeEventListener('pointerup', this.onWindowPointerUp);
    this.root.remove();
  }

  private show(): void {
    this.open = true;
    this.highlighted = -1;
    // Anchor at the holding finger when this came from touch; else screen center.
    const useFinger = this.fromPointer && this.havePointer;
    this.cx = useFinger
      ? Math.min(Math.max(this.lastPointerX, EDGE_MARGIN), window.innerWidth - EDGE_MARGIN)
      : window.innerWidth / 2;
    this.cy = useFinger
      ? Math.min(Math.max(this.lastPointerY, EDGE_MARGIN), window.innerHeight - EDGE_MARGIN)
      : window.innerHeight / 2;
    this.layoutAround(this.cx, this.cy);
    this.root.classList.remove('hidden');
  }

  private hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
    this.buttons.forEach((b) => b.classList.remove('hot'));
  }

  /** Position the option ring + hint around a center point (CSS px). */
  private layoutAround(cx: number, cy: number): void {
    EMOTE_KINDS.forEach((_, i) => {
      const angle = (i / EMOTE_KINDS.length) * Math.PI * 2 - Math.PI / 2;
      const b = this.buttons[i]!;
      b.style.left = `${Math.round(cx + Math.cos(angle) * RADIUS)}px`;
      b.style.top = `${Math.round(cy + Math.sin(angle) * RADIUS)}px`;
    });
    this.hint.style.left = `${Math.round(cx)}px`;
    this.hint.style.top = `${Math.round(cy)}px`;
  }

  private highlight(i: number): void {
    this.highlighted = i;
    this.buttons.forEach((b, j) => b.classList.toggle('hot', j === i));
  }

  private highlightNearest(x: number, y: number): void {
    // Cached center — no per-move layout read.
    if (Math.hypot(x - this.cx, y - this.cy) < DEAD_RADIUS) {
      this.highlight(-1);
      return;
    }
    const angle = Math.atan2(y - this.cy, x - this.cx) + Math.PI / 2;
    const n = EMOTE_KINDS.length;
    const idx = (Math.round((angle / (Math.PI * 2)) * n) + n) % n;
    this.highlight(idx);
  }

  private send(i: number): void {
    if (i >= 0) this.onSend(EMOTE_KINDS[i]!);
    this.hide();
  }
}
