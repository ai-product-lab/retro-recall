import { Canvas2DRenderer } from '@retro-recall/retrokit/render';
import { KeyboardInput } from '@retro-recall/retrokit/input';
import { startLoop } from '@retro-recall/retrokit/loop';
import { LEVEL_HEIGHT, LEVEL_WIDTH, TILE_SIZE } from './sim/constants';
import { BubbleBuddiesSim } from './sim/sim';
import { render } from './render/index';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('missing #game canvas');

const renderer = new Canvas2DRenderer(canvas, LEVEL_WIDTH * TILE_SIZE, LEVEL_HEIGHT * TILE_SIZE);
const input = new KeyboardInput(window);
// Seeding from the clock is fine out here in the shell — the seed is the
// recorded starting point; determinism is about what follows from it.
const sim = new BubbleBuddiesSim(Date.now() >>> 0);

startLoop({
  tick: () => sim.tick(input.sample()),
  render: () => render(renderer, sim),
});
