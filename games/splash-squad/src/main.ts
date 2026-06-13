/**
 * Splash Squad local boot (solo practice). Runs the sim stub at a fixed 60 Hz with
 * keyboard + touch input and draws it. Online play wires through
 * @retro-recall/netcode later — see games/splash-squad/SPEC.md.
 */
import { Canvas2DRenderer } from '@retro-recall/retrokit/render';
import { Button } from '@retro-recall/retrokit/sim';
import { SplashSquadSim } from './sim/sim';
import { render } from './render/index';
import { GAME_W, GAME_H, layoutCanvas, mountControls } from './shell/layout';

const TICK_MS = 1000 / 60;
const KEYMAP: Record<string, number> = {
  ArrowLeft: Button.Left,
  ArrowRight: Button.Right,
  KeyZ: Button.A,
  Space: Button.A,
  ArrowUp: Button.A,
};

const canvas = document.querySelector<HTMLCanvasElement>('#game');
const controls = document.querySelector<HTMLElement>('#controls');

if (canvas) {
  const r = new Canvas2DRenderer(canvas, GAME_W, GAME_H, 1);
  layoutCanvas(canvas);
  window.addEventListener('resize', () => layoutCanvas(canvas));

  const touchInput = controls ? mountControls(controls) : (): number => 0;

  let keyBits = 0;
  window.addEventListener('keydown', (e) => {
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

  const sim = new SplashSquadSim((Date.now() >>> 0) || 1);
  sim.joinPlayer(0);

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
    render(r, sim.state);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
