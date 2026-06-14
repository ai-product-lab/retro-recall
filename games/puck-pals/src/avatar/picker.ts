/**
 * Join-time avatar picker. Tap one of the 8 fallback creatures, or snap/upload
 * a photo (→ Avatar Worker → a generated head). There is always a valid
 * selection (a creature is pre-picked), so JOIN is never blocked — even with no
 * camera, no worker, or a declined generation. Each option previews the actual
 * head you'll wear, via the shared HeadStore (which also warms the render cache).
 */
import { GALLERY_SIZE, galleryId } from '@retro-recall/avatar';
import { generateAvatar } from './generate';
import type { HeadStore } from './heads';

export interface AvatarPickerEls {
  /** Container the option buttons render into. */
  options: HTMLElement;
  /** "Use my photo" button. */
  photoBtn: HTMLButtonElement;
  /** Hidden <input type=file accept=image/* capture=user>. */
  fileInput: HTMLInputElement;
  /** Small status/explanation line. */
  status: HTMLElement;
}

export interface AvatarPicker {
  getAvatarId(): string;
}

const THUMB = 40; // px

function drawHead(canvas: HTMLCanvasElement, bitmap: ImageBitmap): void {
  canvas.width = THUMB;
  canvas.height = THUMB;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, THUMB, THUMB);
  ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, THUMB, THUMB);
}

export function setupAvatarPicker(els: AvatarPickerEls, store: HeadStore, room: string): AvatarPicker {
  let selectedId = galleryId(0);
  const buttons = new Map<string, HTMLButtonElement>();

  const select = (id: string): void => {
    selectedId = id;
    for (const [bid, btn] of buttons) btn.classList.toggle('selected', bid === id);
  };

  const addOption = (id: string, label: string, prepend = false): void => {
    if (buttons.has(id)) {
      select(id);
      return;
    }
    const btn = document.createElement('button');
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
    void store.load(id).then((bmp) => {
      if (bmp) drawHead(canvas, bmp);
      else btn.classList.add('broken');
    });
  };

  for (let i = 0; i < GALLERY_SIZE; i++) addOption(galleryId(i), `creature ${i + 1}`);
  select(galleryId(0));

  els.photoBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files?.[0];
    els.fileInput.value = '';
    if (!file) return;
    els.status.textContent = 'making your skater…';
    els.photoBtn.disabled = true;
    void generateAvatar(file, room).then((result) => {
      els.photoBtn.disabled = false;
      if (result.ok) {
        addOption(result.avatarId, 'you', true);
        select(result.avatarId);
        els.status.textContent = "that's you! ✓ (or tap a creature instead)";
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
  api_error: 'photo-maker is offline — pick a creature below',
};
