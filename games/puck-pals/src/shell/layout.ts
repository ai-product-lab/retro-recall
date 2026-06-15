/**
 * Puck Pals touch controls (ADR-012 landscape-only 16:9). The round skate pad
 * (an analog-feel 8-way stick whose knob follows the thumb) and the two action
 * buttons — whose labels swap with possession (Pass/Shoot while carrying, Check
 * otherwise) — are mounted into overlay zones the shell layout engine positions
 * in the bottom corners. Built on the shared touch primitives; the sim never
 * knows fingers exist. The canvas is sized by @retro-recall/shell's startLayout.
 */
import { Button } from '@retro-recall/retrokit/sim';
import {
  attachIdleFade,
  bindMomentaryButton,
  createOctantPad,
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

/** Build the skate stick into `stickZone` and the actions into `actionZone`
 *  (both overlay zones positioned by the shell). Pointer-tracked + idle-faded. */
export function mountControls(stickZone: HTMLElement, actionZone: HTMLElement): TouchPad {
  stickZone.innerHTML = '';
  actionZone.innerHTML = '';

  // --- 8-way skate pad with a knob that follows the thumb ---
  const pad = document.createElement('div');
  pad.className = 'skate';
  const knob = document.createElement('div');
  knob.className = 'skate-knob';
  pad.append(knob);
  stickZone.append(pad);
  const stick = createOctantPad(stickZone, pad, {
    bits: CARDINALS,
    deadzoneRatio: 0.14,
    analogKnob: knob,
  });

  // --- Action buttons (labels swap with possession) ---
  const actions = document.createElement('div');
  actions.className = 'actions';
  const bBtn = document.createElement('button');
  bBtn.className = 'ctl act-b';
  const aBtn = document.createElement('button');
  aBtn.className = 'ctl act-a';
  actions.append(bBtn, aBtn);
  actionZone.append(actions);
  const bBind = bindMomentaryButton(bBtn);
  const aBind = bindMomentaryButton(aBtn);
  suppressGestures(actionZone);
  const stopFade = attachIdleFade([stickZone, actionZone]);

  let carrying = false;
  const setCarrying = (c: boolean): void => {
    carrying = c;
    bBtn.textContent = c ? 'SHOOT' : 'CHECK';
    aBtn.textContent = c ? 'PASS' : '';
    aBtn.classList.toggle('dim', !c);
    // Disable PASS when there's nothing to pass — no no-op A presses.
    aBtn.disabled = !c;
    if (!c) aBind.release();
  };
  setCarrying(false);

  return {
    sample: () =>
      stick.sample() | (bBind.held() ? Button.B : 0) | (carrying && aBind.held() ? Button.A : 0),
    setCarrying,
    destroy: () => {
      stopFade();
      stick.destroy();
      bBind.destroy();
      aBind.destroy();
      pad.remove();
      actions.remove();
    },
  };
}
