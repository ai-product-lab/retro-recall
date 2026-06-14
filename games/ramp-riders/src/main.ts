/**
 * Ramp Riders local boot (solo practice). Runs the sim at a fixed 60 Hz with
 * keyboard + touch input and draws it through the camera-scrolled view. Online
 * play wires through @retro-recall/netcode on the play route (play/ramp-riders)
 * — see games/ramp-riders/SPEC.md §10.
 */
import { Canvas2DRenderer } from '@retro-recall/retrokit/render';
import { Button } from '@retro-recall/retrokit/sim';
import { RampRidersSim } from './sim/sim';
import { RampRidersView } from './render/index';
import { GAME_W, GAME_H, layoutCanvas, mountControls } from './shell/layout';
import { installZoomGuard, onViewportChange } from '@retro-recall/shell';

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
const controls = document.querySelector<HTMLElement>('#controls');

if (canvas) {
  installZoomGuard();
  const r = new Canvas2DRenderer(canvas, GAME_W, GAME_H, 1);
  const view = new RampRidersView();
  layoutCanvas(canvas);
  onViewportChange(() => layoutCanvas(canvas)); // rotate/resize/visualViewport + iOS settle

  const touchInput = controls ? mountControls(controls) : (): number => 0;

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
      sim.tick([keyBits | touchInput()]);
      acc -= TICK_MS;
      steps++;
    }
    view.render(r, sim.state, 0);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
