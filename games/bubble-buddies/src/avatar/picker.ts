/**
 * Join-time avatar picker. The player either snaps/uploads a photo (→ Avatar
 * Worker → a generated buddy) or taps one of the 8 fallback creatures. There is
 * always a valid selection (a gallery creature is pre-picked), so JOIN is never
 * blocked — even with no camera, no worker, or a declined generation.
 *
 * Each option is drawn as its *idle composited frame* — what you'll actually be
 * on screen — using the shared AvatarStore, so the picker doubles as a warm-up
 * of the render cache.
 */

import { GALLERY_SIZE, galleryId } from '@retro-recall/avatar';
import { generateAvatar } from './generate';
import type { AvatarSprite, AvatarStore } from './store';

export interface AvatarPickerEls {
  /** Container the option buttons are rendered into. */
  options: HTMLElement;
  /** "Use my photo" button. */
  photoBtn: HTMLButtonElement;
  /** Hidden <input type=file accept=image/* capture=user>. */
  fileInput: HTMLInputElement;
  /** Small status/explanation line. */
  status: HTMLElement;
}

export interface AvatarPicker {
  /** The currently chosen avatarId (always defined). */
  getAvatarId(): string;
}

const THUMB_SCALE = 4; // 16px frame → 64px thumbnail

function drawIdle(canvas: HTMLCanvasElement, sprite: AvatarSprite): void {
  const fs = sprite.frameSize;
  canvas.width = fs * THUMB_SCALE;
  canvas.height = fs * THUMB_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Frame 0 is the first idle frame (sheet layout starts with idle).
  ctx.drawImage(sprite.bitmap, 0, 0, fs, fs, 0, 0, canvas.width, canvas.height);
}

export function setupAvatarPicker(els: AvatarPickerEls, store: AvatarStore, room: string): AvatarPicker {
  let selectedId = galleryId(0);
  const buttons = new Map<string, HTMLButtonElement>();

  const select = (id: string): void => {
    selectedId = id;
    for (const [bid, btn] of buttons) btn.classList.toggle('selected', bid === id);
  };

  /** Add (or reuse) an option button for an id and draw it when its sprite is
   *  ready. `prepend` puts a freshly generated buddy first. */
  const addOption = (id: string, label: string, prepend = false): void => {
    let btn = buttons.get(id);
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'avatar-opt';
      btn.title = label;
      btn.setAttribute('aria-label', label);
      const canvas = document.createElement('canvas');
      btn.append(canvas);
      btn.addEventListener('click', () => select(id));
      buttons.set(id, btn);
      if (prepend) els.options.prepend(btn);
      else els.options.append(btn);
      void store.load(id).then((sprite) => {
        if (sprite) drawIdle(canvas, sprite);
        else btn!.classList.add('broken');
      });
    }
  };

  // The fallback creatures, pre-warmed; default to a varied starting pick.
  for (let i = 0; i < GALLERY_SIZE; i++) addOption(galleryId(i), `creature ${i + 1}`);
  select(galleryId(Math.floor(Math.random() * GALLERY_SIZE)));

  els.photoBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files?.[0];
    els.fileInput.value = ''; // allow re-picking the same file
    if (!file) return;
    els.status.textContent = 'making your buddy…';
    els.photoBtn.disabled = true;
    void generateAvatar(file, room).then((result) => {
      els.photoBtn.disabled = false;
      if (result.ok) {
        addOption(result.avatarId, 'you', true);
        select(result.avatarId);
        els.status.textContent = "that's you! ✓ (or pick a creature instead)";
      } else {
        els.status.textContent = REASON_COPY[result.reason] ?? 'pick a creature below';
      }
    });
  });

  return { getAvatarId: () => selectedId };
}

const REASON_COPY: Record<string, string> = {
  moderation: "couldn't use that photo — pick a creature below",
  rate_limited: 'too many tries today — pick a creature below',
  bad_input: "couldn't read that image — pick a creature below",
  api_error: 'buddy-maker is offline — pick a creature below',
};
