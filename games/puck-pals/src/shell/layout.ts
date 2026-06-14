/**
 * Puck Pals shell (ADR-007 mobile-first). Integer-scales the camera view to the
 * viewport in either orientation and mounts touch controls that report a
 * NES-style bitmask — the sim never knows fingers exist. Two zones: an 8-way
 * skate pad and two action buttons whose labels swap with possession
 * (Pass/Shoot while carrying, Check otherwise). CSS reflows them per orientation.
 *
 * The pointer plumbing (multi-touch capture, focus-loss release) and the octant
 * math come from @retro-recall/shell — Puck Pals only describes its surface
 * (round skate stick + action buttons), not how touches are tracked.
 */
import { Button } from '@retro-recall/retrokit/sim';
import {
  bindMomentaryButton,
  createOctantPad,
  prefersTouchUI,
  suppressGestures,
  type OctantBitset,
} from '@retro-recall/shell';

/** Logical render resolution = the camera view (one screen). */
export const GAME_W = 256;
export const GAME_H = 192;

const CARDINALS: OctantBitset = {
  up: Button.Up,
  down: Button.Down,
  left: Button.Left,
  right: Button.Right,
};

export interface TouchPad {
  sample(): number;
  /** Swap the action-button labels to match possession. */
  setCarrying(carrying: boolean): void;
  destroy(): void;
}

/** Integer-scale the canvas to fit the viewport; stamp orientation + input. */
export function layoutCanvas(canvas: HTMLCanvasElement): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const portrait = vh >= vw;
  // Portrait leaves room below for controls; landscape flanks the canvas.
  const budgetH = portrait ? vh * 0.62 : vh - 24;
  const scale = Math.max(1, Math.floor(Math.min((vw - 16) / GAME_W, budgetH / GAME_H)));
  canvas.style.width = GAME_W * scale + 'px';
  canvas.style.height = GAME_H * scale + 'px';
  document.body.dataset['orientation'] = portrait ? 'portrait' : 'landscape';
  document.body.dataset['input'] = prefersTouchUI() ? 'touch' : 'keyboard';
}

/** Build touch controls into `root`; pointer-tracked so move + act overlap. */
export function mountControls(root: HTMLElement): TouchPad {
  root.innerHTML = '';

  // --- 8-way skate pad (shared octant primitive) ---
  const pad = document.createElement('div');
  pad.className = 'ctl-zone skate';
  const knob = document.createElement('div');
  knob.className = 'skate-knob';
  pad.append(knob);
  const stick = createOctantPad(pad, pad, { bits: CARDINALS, deadzoneRatio: 0.14 });

  // --- Action buttons (labels swap with possession) ---
  const actions = document.createElement('div');
  actions.className = 'ctl-zone actions';
  const bBtn = document.createElement('button');
  bBtn.className = 'ctl act-b';
  const aBtn = document.createElement('button');
  aBtn.className = 'ctl act-a';
  actions.append(bBtn, aBtn);
  const bBind = bindMomentaryButton(bBtn);
  const aBind = bindMomentaryButton(aBtn);

  root.append(pad, actions);
  suppressGestures(actions);

  let carrying = false;
  const setCarrying = (c: boolean): void => {
    carrying = c;
    bBtn.textContent = c ? 'SHOOT' : 'CHECK';
    aBtn.textContent = c ? 'PASS' : '';
    aBtn.classList.toggle('dim', !c);
    // Disable PASS when there's nothing to pass — a disabled button receives no
    // pointer events, so a thumb resting there no longer fires no-op A presses.
    aBtn.disabled = !c;
    if (!c) aBind.release();
  };
  setCarrying(false);

  return {
    sample: () =>
      stick.sample() | (bBind.held() ? Button.B : 0) | (carrying && aBind.held() ? Button.A : 0),
    setCarrying,
    destroy: () => {
      stick.destroy();
      bBind.destroy();
      aBind.destroy();
      pad.remove();
      actions.remove();
    },
  };
}
