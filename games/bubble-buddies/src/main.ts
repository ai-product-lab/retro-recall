/**
 * Home page solo practice: tap-to-start gate (doubles as the iOS audio
 * unlock per ADR-007), then the local sim with keyboard + touch feeding the
 * same input bitmask.
 */
import './shell/shell.css';
import { Canvas2DRenderer } from '@retro-recall/retrokit/render';
import { KeyboardInput } from '@retro-recall/retrokit/input';
import { startLoop } from '@retro-recall/retrokit/loop';
import { LEVEL_HEIGHT, LEVEL_WIDTH, TILE_SIZE } from './sim/constants';
import { BubbleBuddiesSim } from './sim/sim';
import { render } from './render/index';
import {
  applyInputMode,
  createTouchControls,
  startLayout,
  type TouchControls,
} from '@retro-recall/shell';
import { unlockAudio } from './shell/audio';
import { offerInstall, registerServiceWorker } from './shell/pwa';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

const inputMode = applyInputMode();
registerServiceWorker();
offerInstall($('#install-slot'), true);

const canvas = $<HTMLCanvasElement>('#game');
const gate = $<HTMLButtonElement>('#start-gate');

// displayScale 1: the layout engine owns the CSS size from here on.
const renderer = new Canvas2DRenderer(canvas, LEVEL_WIDTH * TILE_SIZE, LEVEL_HEIGHT * TILE_SIZE, 1);
const keyboard = new KeyboardInput(window);
let touch: TouchControls | null = null;
if (inputMode === 'touch') {
  touch = createTouchControls($('#dpad'), $('#abzone'));
}

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

// Seeding from the clock is fine out here in the shell — the seed is the
// recorded starting point; determinism is about what follows from it.
const sim = new BubbleBuddiesSim(Date.now() >>> 0);

let started = false;
const start = (): void => {
  if (started) return;
  started = true;
  unlockAudio();
  gate.remove();
  startLoop({
    tick: () => sim.tick([keyboard.sample() | (touch?.sample() ?? 0)]),
    render: () => render(renderer, sim.map, sim.state),
  });
};
gate.addEventListener('click', start);
window.addEventListener('keydown', () => {
  // Don't steal keys from the join-code input.
  if (document.activeElement?.tagName !== 'INPUT') start();
});
