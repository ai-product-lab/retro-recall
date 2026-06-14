/**
 * Mobile-first layout engine (ADR-007). The playfield always renders at an
 * integer multiple of 256×192 — integer in *device* pixels, so a 3× iPhone
 * can use e.g. 4 device px per logical px (a fractional CSS size that is
 * still a pixel-perfect upscale). Never stretched.
 *
 * Landscape = NES-held-sideways: playfield centered at max integer scale,
 * d-pad zone in the left pillarbox bar, A/B in the right.
 * Portrait = Game Boy: playfield at top at max width-fitting integer scale,
 * controller area below (d-pad left, A/B right).
 *
 * Relayouts live on rotate, window resize, and visualViewport changes.
 * Safe areas are handled by #stage padding (env(safe-area-inset-*)); this
 * module only ever measures and positions inside #arena, the padded box.
 */

export interface LayoutRefs {
  /** The safe-area-padded box everything is positioned inside. */
  arena: HTMLElement;
  /** The game canvas. */
  playfield: HTMLElement;
  /** Top bar (title / room / status). Optional; measured, not positioned. */
  hud?: HTMLElement | null;
  /** Touch zones. Hidden entirely on keyboard devices. */
  dpad?: HTMLElement | null;
  buttons?: HTMLElement | null;
  /** Keyboard legend line (desktop only) — reserved below the playfield. */
  keysHint?: HTMLElement | null;
  /** Elements that mirror the playfield rect exactly (e.g. start gate). */
  playfieldOverlays?: HTMLElement[];
}

export interface LayoutState {
  orientation: 'portrait' | 'landscape';
  /** Device pixels per logical pixel (the integer the whole layout obeys). */
  scale: number;
  playfieldCss: { x: number; y: number; w: number; h: number };
}

export interface LayoutOptions {
  logicalW?: number;
  logicalH?: number;
  /** Reserve room for touch zones. Default: caller decides via device.ts. */
  touch?: boolean;
  onChange?: (layout: LayoutState) => void;
}

/** Narrowest pillarbox bar (CSS px) we accept before shrinking the scale.
 *  Must clear the widest control art: the A/B cluster (~146px) > d-pad (120px). */
const MIN_SIDE_BAR = 150;
/** Shortest controller band under a portrait playfield. */
const MIN_CONTROL_BAND = 168;
/** Tallest useful band — beyond this, anchor controls low, near the thumbs. */
const MAX_CONTROL_BAND = 320;
const GAP = 8;

/**
 * Controller band height (px). Guarantees at least `min` even when the playfield
 * leaves less room — the band keeps a usable hit area and the playfield
 * overlap-shrinks rather than the controls collapsing to zero/negative height.
 * Pure; exported for tests.
 */
export const controlBand = (freeBelow: number, min = MIN_CONTROL_BAND, max = MAX_CONTROL_BAND): number =>
  Math.max(min, Math.min(freeBelow, max));

/** Largest integer device-px-per-logical-px that fits, never below 1. Pure. */
export const integerScale = (availWpx: number, availHpx: number, logicalW: number, logicalH: number): number =>
  Math.max(1, Math.floor(Math.min(availWpx / logicalW, availHpx / logicalH)));

/**
 * Run `cb` whenever the viewport changes — resize, rotate, and visualViewport
 * shifts (URL bar, on-screen keyboard) — coalesced to one call per frame. A
 * rotate also re-fires after a 200ms settle because iOS reports stale viewport
 * sizes right at orientationchange. Every game (not just the ones using
 * startLayout) shares this so rotation handling is authored once. Returns a
 * teardown.
 */
export function onViewportChange(cb: () => void): () => void {
  let raf = 0;
  const schedule = (): void => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(cb);
  };
  const onRotate = (): void => {
    schedule();
    setTimeout(schedule, 200);
  };
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', onRotate);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', onRotate);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
  };
}

const place = (el: HTMLElement, x: number, y: number, w: number, h: number): void => {
  el.style.position = 'absolute';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
};

export function startLayout(refs: LayoutRefs, opts: LayoutOptions = {}): {
  relayout: () => void;
  current: () => LayoutState;
  stop: () => void;
} {
  const logicalW = opts.logicalW ?? 256;
  const logicalH = opts.logicalH ?? 192;
  const touch = opts.touch ?? false;
  let state: LayoutState = {
    orientation: 'landscape',
    scale: 1,
    playfieldCss: { x: 0, y: 0, w: logicalW, h: logicalH },
  };

  const relayout = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const aw = refs.arena.clientWidth;
    const ah = refs.arena.clientHeight;
    if (aw === 0 || ah === 0) return;

    const orientation: LayoutState['orientation'] = aw >= ah ? 'landscape' : 'portrait';
    refs.arena.dataset['orientation'] = orientation;
    document.body.dataset['orientation'] = orientation;

    // Measure chrome *after* the orientation class applies (it changes hud shape).
    const hudH = refs.hud ? refs.hud.offsetHeight + GAP : 0;
    const keysH = refs.keysHint && !touch ? refs.keysHint.offsetHeight + GAP : 0;
    const availW = aw;
    const availH = ah - hudH - keysH;

    let scale: number;
    if (orientation === 'landscape') {
      const sideReserve = touch ? MIN_SIDE_BAR : 0;
      scale = integerScale((availW - 2 * sideReserve) * dpr, availH * dpr, logicalW, logicalH);
    } else {
      const bandReserve = touch ? MIN_CONTROL_BAND : 0;
      scale = integerScale(availW * dpr, (availH - bandReserve) * dpr, logicalW, logicalH);
    }

    // Snap the playfield origin to the device-pixel grid so the integer
    // upscale stays crisp (a half-device-pixel offset would resample).
    const snap = (v: number): number => Math.round(v * dpr) / dpr;
    const w = (logicalW * scale) / dpr;
    const h = (logicalH * scale) / dpr;
    let x: number;
    let y: number;
    if (orientation === 'landscape') {
      x = snap((aw - w) / 2);
      y = snap(hudH + (availH - h) / 2);
    } else {
      x = snap((aw - w) / 2);
      y = snap(hudH);
    }

    place(refs.playfield, x, y, w, h);
    for (const el of refs.playfieldOverlays ?? []) place(el, x, y, w, h);

    if (refs.dpad && refs.buttons) {
      refs.dpad.hidden = !touch;
      refs.buttons.hidden = !touch;
      if (touch) {
        if (orientation === 'landscape') {
          // The pillarbox bars are the controller (NES held sideways).
          place(refs.dpad, 0, hudH, x, ah - hudH);
          place(refs.buttons, x + w, hudH, aw - (x + w), ah - hudH);
        } else {
          // Game Boy: the band below the playfield, d-pad left, A/B right.
          // On tall screens, anchor the band low — that's where thumbs rest.
          // controlBand() guarantees a usable height even on short viewports.
          const bandH = controlBand(ah - (y + h));
          const bandY = ah - bandH;
          place(refs.dpad, 0, bandY, aw / 2, bandH);
          place(refs.buttons, aw / 2, bandY, aw / 2, bandH);
        }
      }
    }

    // Keyboard legend is desktop-only; placing it on touch would land it in the
    // controller band (no vertical space is reserved for it there).
    if (refs.keysHint && !touch) {
      refs.keysHint.style.position = 'absolute';
      refs.keysHint.style.left = '0';
      refs.keysHint.style.right = '0';
      refs.keysHint.style.top = `${y + h + GAP}px`;
    }

    state = { orientation, scale, playfieldCss: { x, y, w, h } };
    opts.onChange?.(state);
  };

  // Coalesce bursts (rotate fires resize + visualViewport + orientationchange)
  // and re-settle after iOS's stale post-rotate viewport — shared scheduler.
  const stop = onViewportChange(relayout);

  relayout();
  // The first pass may have measured the hud before fonts/styles settled.
  requestAnimationFrame(relayout);

  return {
    relayout,
    current: () => state,
    stop,
  };
}
