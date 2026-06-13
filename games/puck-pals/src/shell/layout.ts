/**
 * Puck Pals shell (ADR-007 mobile-first). Integer-scales the camera view to the
 * viewport in either orientation and mounts touch controls that report a
 * NES-style bitmask — the sim never knows fingers exist. Two zones: an 8-way
 * skate pad and two action buttons whose labels swap with possession
 * (Pass/Shoot while carrying, Check otherwise). CSS reflows them per orientation.
 */
import { Button } from '@retro-recall/retrokit/sim';

/** Logical render resolution = the camera view (one screen). */
export const GAME_W = 256;
export const GAME_H = 192;

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
  document.body.dataset['input'] =
    window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0
      ? 'touch'
      : 'keyboard';
}

const OCTANT_BITS: readonly number[] = [
  Button.Right,
  Button.Right | Button.Down,
  Button.Down,
  Button.Down | Button.Left,
  Button.Left,
  Button.Left | Button.Up,
  Button.Up,
  Button.Up | Button.Right,
];

/** Build touch controls into `root`; pointer-tracked so move + act overlap. */
export function mountControls(root: HTMLElement): TouchPad {
  root.innerHTML = '';

  // --- 8-way skate pad ---
  const pad = document.createElement('div');
  pad.className = 'ctl-zone skate';
  const knob = document.createElement('div');
  knob.className = 'skate-knob';
  pad.append(knob);

  const padPointers = new Map<number, number>();
  let padBits = 0;
  const padVector = (e: PointerEvent): number => {
    const r = pad.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const dead = Math.max(10, r.width * 0.14);
    if (Math.hypot(dx, dy) < dead) return 0;
    const octant = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
    return OCTANT_BITS[octant]!;
  };
  const refreshPad = (): void => {
    padBits = 0;
    for (const b of padPointers.values()) padBits |= b;
  };
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    padPointers.set(e.pointerId, padVector(e));
    refreshPad();
  });
  pad.addEventListener('pointermove', (e) => {
    if (!padPointers.has(e.pointerId)) return;
    padPointers.set(e.pointerId, padVector(e));
    refreshPad();
  });
  const padUp = (e: PointerEvent): void => {
    if (padPointers.delete(e.pointerId)) refreshPad();
  };
  pad.addEventListener('pointerup', padUp);
  pad.addEventListener('pointercancel', padUp);

  // --- Action buttons (labels swap with possession) ---
  const actions = document.createElement('div');
  actions.className = 'ctl-zone actions';
  const bBtn = document.createElement('button');
  bBtn.className = 'ctl act-b';
  const aBtn = document.createElement('button');
  aBtn.className = 'ctl act-a';
  actions.append(bBtn, aBtn);

  const btnPointers = new Map<number, number>();
  let btnBits = 0;
  const bind = (el: HTMLButtonElement, bit: number): void => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      btnPointers.set(e.pointerId, bit);
      el.classList.add('held');
      btnBits = 0;
      for (const b of btnPointers.values()) btnBits |= b;
    });
    const up = (e: PointerEvent): void => {
      if (!btnPointers.delete(e.pointerId)) return;
      el.classList.remove('held');
      btnBits = 0;
      for (const b of btnPointers.values()) btnBits |= b;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  bind(bBtn, Button.B);
  bind(aBtn, Button.A);

  root.append(pad, actions);
  [pad, actions].forEach((z) => {
    z.style.touchAction = 'none';
    z.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  const setCarrying = (carrying: boolean): void => {
    bBtn.textContent = carrying ? 'SHOOT' : 'CHECK';
    aBtn.textContent = carrying ? 'PASS' : '';
    aBtn.classList.toggle('dim', !carrying);
  };
  setCarrying(false);

  const onBlur = (): void => {
    padPointers.clear();
    btnPointers.clear();
    refreshPad();
    btnBits = 0;
    bBtn.classList.remove('held');
    aBtn.classList.remove('held');
  };
  window.addEventListener('blur', onBlur);

  return {
    sample: () => padBits | btnBits,
    setCarrying,
    destroy: () => {
      window.removeEventListener('blur', onBlur);
      pad.remove();
      actions.remove();
    },
  };
}
