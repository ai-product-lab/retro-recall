/**
 * Ramp Riders shell (ADR-007 mobile-first). Integer-scales the canvas to the
 * viewport in either orientation and mounts touch controls that report a
 * NES-style input bitmask (SPEC §9):
 *   - left thumb: lane Up / Down
 *   - right thumb: Pedal (A) + Pump (B)
 *   - lower corners: Lean (Left / Right) — used in the air
 * CSS (shell.css) repositions the zones per orientation via [data-orientation].
 *
 * Buttons are built on @retro-recall/shell's bindMomentaryButton: it captures
 * the pointer (so a thumb that drifts past the edge keeps the throttle held —
 * the old per-button pointerleave→release silently cut the pedal) and releases
 * on blur/visibilitychange/pagehide (no more stuck inputs after backgrounding).
 */
import { Button } from '@retro-recall/retrokit/sim';
import { bindMomentaryButton, prefersTouchUI, suppressGestures } from '@retro-recall/shell';

/** Logical game resolution — matches the renderer / sim viewport. */
export const GAME_W = 256;
export const GAME_H = 144;

/** Integer-scale the canvas to fit the viewport, and stamp orientation/input. */
export function layoutCanvas(canvas: HTMLCanvasElement): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const landscape = vw >= vh;
  // Landscape: canvas can use most of the height. Portrait: top ~55%.
  const maxH = landscape ? vh - 16 : vh * 0.55;
  const scale = Math.max(1, Math.floor(Math.min((vw - 8) / GAME_W, maxH / GAME_H)));
  canvas.style.width = GAME_W * scale + 'px';
  canvas.style.height = GAME_H * scale + 'px';
  document.body.dataset['orientation'] = landscape ? 'landscape' : 'portrait';
  document.body.dataset['input'] = prefersTouchUI() ? 'touch' : 'keyboard';
}

/** Build on-screen controls into `root`; returns a sampler of the touch bitmask.
 *  No module-global state — each button owns its held flag via the shared
 *  primitive, so two mounts (or a remount) never share or leak bits. */
export function mountControls(root: HTMLElement): () => number {
  const held: { bit: number; isHeld: () => boolean }[] = [];
  const make = (label: string, bit: number, cls: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = 'ctl ' + cls;
    b.textContent = label;
    b.setAttribute('aria-label', cls);
    const binding = bindMomentaryButton(b);
    held.push({ bit, isHeld: binding.held });
    return b;
  };

  const lanes = document.createElement('div');
  lanes.className = 'ctl-zone lanes';
  lanes.append(make('▲', Button.Up, 'lane-up'), make('▼', Button.Down, 'lane-down'));

  const lean = document.createElement('div');
  lean.className = 'ctl-zone lean';
  lean.append(make('↺', Button.Left, 'lean-back'), make('↻', Button.Right, 'lean-fwd'));

  const throttle = document.createElement('div');
  throttle.className = 'ctl-zone throttle';
  throttle.append(make('PEDAL', Button.A, 'pedal'), make('PUMP', Button.B, 'pump'));

  root.append(lanes, lean, throttle);
  suppressGestures(root); // touch-action:none + no context menu across all zones

  return () => held.reduce((bits, h) => bits | (h.isHeld() ? h.bit : 0), 0);
}
