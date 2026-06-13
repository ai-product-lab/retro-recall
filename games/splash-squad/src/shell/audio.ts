/**
 * Splash Squad SFX — a tiny WebAudio synth (SPEC §12: music-free, sound is a
 * view-layer concern; the sim never makes noise, so determinism is untouched).
 * No asset files — every sound is generated, which also keeps ADR-005 asset
 * provenance trivial. iOS only allows audio after a gesture, so every "start"
 * tap routes through unlockAudio().
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** Call from inside a user-gesture handler. Safe to call repeatedly. */
export function unlockAudio(): void {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // No audio available — never let sound break play.
  }
}

export const audioContext = (): AudioContext | null => ctx;

/** One enveloped oscillator blip. All times in seconds from `now`. */
function blip(
  freq: number,
  dur: number,
  opts: { type?: OscillatorType; gain?: number; slideTo?: number; delay?: number } = {},
): void {
  if (!ctx || !master || ctx.state !== 'running') return;
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type ?? 'square';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t0 + dur);
  const peak = opts.gain ?? 0.25;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** A short burst of filtered noise — the watery "squirt"/"splash". */
function splash(dur: number, gain: number): void {
  if (!ctx || !master || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  const frames = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1800;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
}

export type SfxEvent =
  | 'squirt'
  | 'splashHit'
  | 'sputter'
  | 'chain'
  | 'pickup'
  | 'refill'
  | 'downed'
  | 'revive'
  | 'bossHit'
  | 'bossDefeat'
  | 'clear'
  | 'win'
  | 'gameover';

export function playSfx(event: SfxEvent): void {
  switch (event) {
    case 'squirt':
      splash(0.07, 0.12);
      break;
    case 'splashHit':
      splash(0.05, 0.18);
      blip(520, 0.06, { type: 'sine', gain: 0.12 });
      break;
    case 'sputter':
      blip(360, 0.22, { type: 'sawtooth', gain: 0.2, slideTo: 90 });
      break;
    case 'chain':
      blip(300, 0.28, { type: 'sawtooth', gain: 0.22, slideTo: 900 });
      break;
    case 'pickup':
      blip(660, 0.08, { type: 'square', gain: 0.22 });
      blip(990, 0.1, { type: 'square', gain: 0.22, delay: 0.08 });
      break;
    case 'refill':
      blip(420, 0.05, { type: 'triangle', gain: 0.08, slideTo: 560 });
      break;
    case 'downed':
      blip(380, 0.3, { type: 'square', gain: 0.25, slideTo: 110 });
      break;
    case 'revive':
      blip(440, 0.1, { type: 'square', gain: 0.22 });
      blip(740, 0.14, { type: 'square', gain: 0.22, delay: 0.1 });
      break;
    case 'bossHit':
      blip(200, 0.08, { type: 'square', gain: 0.2, slideTo: 150 });
      break;
    case 'bossDefeat':
      [330, 440, 550, 740].forEach((f, i) => blip(f, 0.18, { gain: 0.25, delay: i * 0.12 }));
      break;
    case 'clear':
      [523, 659, 784].forEach((f, i) => blip(f, 0.16, { gain: 0.24, delay: i * 0.1 }));
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.2, { gain: 0.26, delay: i * 0.13 }));
      break;
    case 'gameover':
      [440, 349, 262].forEach((f, i) => blip(f, 0.3, { type: 'sawtooth', gain: 0.24, delay: i * 0.18 }));
      break;
  }
}
