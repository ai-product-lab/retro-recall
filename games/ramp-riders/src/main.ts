/**
 * Ramp Riders local boot (solo practice). Landscape-only 16:9 (ADR-012): the
 * canvas fills the screen, movement is the round analog-feel stick (Up/Down =
 * lane, Left/Right = lean), and the two buttons are PEDAL (A) + PUMP (B). Runs
 * the sim at a fixed 60 Hz; online play wires through @retro-recall/netcode in
 * play.ts (the /play route).
 */
import './shell/shell.css';
import '@retro-recall/shell/controls.css';
import { Canvas2DRenderer } from '@retro-recall/retrokit/render';
import { Button } from '@retro-recall/retrokit/sim';
import { RampRidersSim } from './sim/sim';
import { RampRidersView } from './render/index';
import { VIEW_W, VIEW_H } from './sim/constants';
import {
  applyInputMode,
  createTouchControls,
  installZoomGuard,
  lockLandscapeOnGesture,
  requireLandscape,
  startLayout,
  type TouchControls,
} from '@retro-recall/shell';

const TICK_MS = 1000 / 60;
const KEYMAP: Record<string, number> = {
  KeyZ: Button.A, // pedal
  KeyX: Button.B, // pump / pre-jump
  ArrowUp: Button.Up, // lane back
  ArrowDown: Button.Down, // lane front
  ArrowLeft: Button.Left, // lean nose up
  ArrowRight: Button.Right, // lean nose down
  Enter: Button.Start,
};

const canvas = document.querySelector<HTMLCanvasElement>('#game');
const arena = document.querySelector<HTMLElement>('#arena');

if (canvas && arena) {
  installZoomGuard();
  requireLandscape();
  // Solo has no start gate, so grab the first tap to attempt the orientation lock.
  const lockOnce = (): void => void lockLandscapeOnGesture();
  window.addEventListener('pointerdown', lockOnce, { once: true });

  const inputMode = applyInputMode();
  const r = new Canvas2DRenderer(canvas, VIEW_W, VIEW_H, 1);
  const view = new RampRidersView();

  const stick = document.querySelector<HTMLElement>('#stick');
  const abzone = document.querySelector<HTMLElement>('#abzone');
  let touch: TouchControls | null = null;
  if (inputMode === 'touch' && stick && abzone) {
    // Stick = lane (Up/Down) + lean (Left/Right); buttons = PUMP (B) / PEDAL (A).
    touch = createTouchControls(stick, abzone, {
      buttons: [
        { label: 'PUMP', bit: Button.B, className: 'b' },
        { label: 'PEDAL', bit: Button.A, className: 'a' },
      ],
      fade: true,
    });
  }
  startLayout(
    { arena, playfield: canvas, dpad: stick, buttons: abzone },
    { overlay: true, touch: inputMode === 'touch', logicalW: VIEW_W, logicalH: VIEW_H },
  );

  let keyBits = 0;
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLElement && e.target.tagName === 'INPUT') return;
    const bit = KEYMAP[e.code];
    if (bit) {
      keyBits |= bit;
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    const bit = KEYMAP[e.code];
    if (bit) keyBits &= ~bit;
  });

  // Solo practice: one rider; track varies by seed (seed % TRACK_COUNT).
  const sim = new RampRidersSim((Date.now() >>> 0) || 1, { players: 1 });

  let acc = 0;
  let last = performance.now();
  const frame = (now: number): void => {
    acc += now - last;
    last = now;
    let steps = 0;
    while (acc >= TICK_MS && steps < 5) {
      sim.tick([keyBits | (touch?.sample() ?? 0)]);
      acc -= TICK_MS;
      steps++;
    }
    view.render(r, sim.state, 0);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
