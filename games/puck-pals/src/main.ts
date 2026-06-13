/**
 * Puck Pals local boot. Runs the sim at a fixed 60 Hz against CPU opponents,
 * draws it through a puck-following camera, and takes keyboard + touch input.
 * Default: you (Home) vs CPU. `?hotseat=1` adds a second keyboard player (Away)
 * for two-at-the-keyboard rivalry. Online versus wires through
 * @retro-recall/netcode next — see games/puck-pals/SPEC.md §11.
 */
import { Canvas2DRenderer } from '@retro-recall/retrokit/render';
import { Camera } from '@retro-recall/retrokit/camera';
import { Button } from '@retro-recall/retrokit/sim';
import { PuckPalsSim } from './sim/sim';
import { render, followPuck, VIEW_W, VIEW_H } from './render/index';
import { GAME_W, GAME_H, layoutCanvas, mountControls } from './shell/layout';
import { HeadStore, headResolver } from './avatar/heads';
import { galleryId } from '@retro-recall/avatar';

const TICK_MS = 1000 / 60;

// P1 (Home): arrows to skate, Z = pass, X = shoot/check, Enter = start/restart.
const P1: Record<string, number> = {
  ArrowLeft: Button.Left,
  ArrowRight: Button.Right,
  ArrowUp: Button.Up,
  ArrowDown: Button.Down,
  KeyZ: Button.A,
  KeyX: Button.B,
  Enter: Button.Start,
};
// P2 (Away, hotseat): WASD to skate, F = pass, G = shoot/check.
const P2: Record<string, number> = {
  KeyA: Button.Left,
  KeyD: Button.Right,
  KeyW: Button.Up,
  KeyS: Button.Down,
  KeyF: Button.A,
  KeyG: Button.B,
};

const hotseat = new URLSearchParams(location.search).get('hotseat') === '1';
const canvas = document.querySelector<HTMLCanvasElement>('#game');
const controls = document.querySelector<HTMLElement>('#controls');

if (canvas) {
  const r = new Canvas2DRenderer(canvas, GAME_W, GAME_H, 1);
  layoutCanvas(canvas);
  window.addEventListener('resize', () => layoutCanvas(canvas));

  const pad = controls ? mountControls(controls) : null;
  const localIds = hotseat ? [0, 10] : [0];

  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if (e.code in P1 || e.code in P2) {
      keys.add(e.code);
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  const sampleMap = (map: Record<string, number>): number => {
    let b = 0;
    for (const code of keys) if (code in map) b |= map[code]!;
    return b;
  };

  const sim = new PuckPalsSim((Date.now() >>> 0) || 1);
  sim.joinPlayer(0); // you are Home
  if (hotseat) sim.joinPlayer(1); // Away at the same keyboard

  // Avatars: your last-picked head (carried over from online) for slot 0, a
  // distinct creature for the hotseat player; CPUs get deterministic faces.
  const heads = new HeadStore();
  const humanAvatars = new Map<number, string>([[0, localStorage.getItem('pp-avatar') ?? galleryId(0)]]);
  if (hotseat) humanAvatars.set(1, galleryId(4));

  const cam = new Camera(VIEW_W, VIEW_H);
  followPuck(cam, sim.state);

  let acc = 0;
  let last = performance.now();
  const frame = (now: number): void => {
    acc += now - last;
    last = now;
    let steps = 0;
    while (acc >= TICK_MS && steps < 5) {
      const p1 = sampleMap(P1) | (pad?.sample() ?? 0);
      const inputs = hotseat ? [p1, sampleMap(P2)] : [p1];
      sim.tick(inputs);
      acc -= TICK_MS;
      steps++;
    }
    pad?.setCarrying(sim.state.puck.carrier === 0);
    followPuck(cam, sim.state);
    render(r, sim.state, cam, {
      localIds,
      headFor: headResolver(heads, sim.state.skaters, humanAvatars),
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
