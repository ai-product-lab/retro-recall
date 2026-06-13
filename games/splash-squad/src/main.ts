/**
 * Splash Squad — solo-practice boot. Tap-to-start gate (also the iOS audio
 * unlock per ADR-007), then the local sim at a fixed 60 Hz with keyboard +
 * dual-orientation touch feeding the same NES-style bitmask. Online co-op wires
 * through @retro-recall/netcode in src/play.ts (the /play route).
 */
import './shell/shell.css';
import { Canvas2DRenderer } from '@retro-recall/retrokit/render';
import { KeyboardInput } from '@retro-recall/retrokit/input';
import { startLoop } from '@retro-recall/retrokit/loop';
import { SCREEN_H, SCREEN_W } from './sim/constants';
import { SplashSquadSim } from './sim/sim';
import { render } from './render/index';
import { applyInputMode } from './shell/device';
import { startLayout } from './shell/layout';
import { createTouchControls, type TouchControls } from './shell/controls';
import { unlockAudio } from './shell/audio';
import { SfxObserver } from './shell/sfx';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

const inputMode = applyInputMode();
const canvas = $<HTMLCanvasElement>('#game');
const gate = $<HTMLButtonElement>('#start-gate');

// displayScale 1: the layout engine owns the CSS size from here on.
const renderer = new Canvas2DRenderer(canvas, SCREEN_W, SCREEN_H, 1);
const keyboard = new KeyboardInput(window);
let touch: TouchControls | null = null;
if (inputMode === 'touch') touch = createTouchControls($('#dpad'), $('#abzone'));

startLayout(
  {
    arena: $('#arena'),
    playfield: canvas,
    hud: $('#hud'),
    dpad: $('#dpad'),
    buttons: $('#abzone'),
    keysHint: document.querySelector<HTMLElement>('.keys'),
    playfieldOverlays: [gate],
  },
  { touch: inputMode === 'touch' },
);

// Seeding from the clock is fine in the shell — the seed is the recorded
// starting point; determinism is about what follows from it.
const sim = new SplashSquadSim((Date.now() >>> 0) || 1);

const sfx = new SfxObserver();
let started = false;
const start = (): void => {
  if (started) return;
  started = true;
  unlockAudio(); // this tap is the iOS audio-unlock gesture (ADR-007)
  gate.remove();
  startLoop({
    tick: () => sim.tick([keyboard.sample() | (touch?.sample() ?? 0)]),
    render: () => {
      render(renderer, sim.state);
      sfx.observe(sim.state);
    },
  });
};
gate.addEventListener('click', start);
window.addEventListener('keydown', () => {
  if (document.activeElement?.tagName !== 'INPUT') start();
});
