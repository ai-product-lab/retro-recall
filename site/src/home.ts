/**
 * Library home — renders the arcade tile grid from the registry, wires the
 * cross-game JOIN CODE chip and the coming-soon PEEK sheet. No framework: the
 * shell is a handful of DOM nodes so it boots instantly on a phone.
 */
import { GAMES, joinRouteForGame, resolveJoinRoute, type GameEntry } from '../registry';
import { glyphSVG } from './art';
import { applyInputMode } from './device';
import { gameForRoom } from './rooms';

const ROOM_CODE = /^[A-Z]{4}$/;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
};

/** Build one game tile. */
function tile(game: GameEntry): HTMLElement {
  const live = game.status === 'live';
  const art = el('div', { class: 'tile-art', style: `--accent:${game.accent}` });
  art.innerHTML = glyphSVG(game.art, 64);

  const cta = live
    ? el('span', { class: 'tile-cta play' }, '▸ PLAY')
    : el('span', { class: 'tile-cta soon' }, '◔ PEEK');

  const card = el(
    'button',
    {
      class: `tile ${live ? 'is-live' : 'is-soon'}`,
      type: 'button',
      'aria-label': live ? `Play ${game.name}` : `Peek at ${game.name}, coming soon`,
    },
    art,
    el('span', { class: 'tile-name' }, game.name),
    el('span', { class: 'tile-meta' }, `${game.players} · ${game.mode.toUpperCase()}`),
    cta,
  );
  if (!live) card.append(el('span', { class: 'tile-ribbon' }, 'SOON'));

  card.addEventListener('click', () => {
    if (live && game.route) location.href = game.route;
    else openPeek(game);
  });
  return card;
}

// --- Modal sheet (bottom sheet on phones, centered card on desktop) ---

function openSheet(content: HTMLElement): void {
  const overlay = el('div', { class: 'sheet-overlay' });
  const sheet = el('div', { class: 'sheet pop-in', role: 'dialog', 'aria-modal': 'true' });
  const close = el('button', { class: 'sheet-close', type: 'button', 'aria-label': 'Close' }, '✕');
  sheet.append(close, content);
  overlay.append(sheet);
  const dismiss = (): void => overlay.remove();
  close.addEventListener('click', dismiss);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss();
  });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') {
      dismiss();
      document.removeEventListener('keydown', esc);
    }
  });
  document.body.append(overlay);
}

function openPeek(game: GameEntry): void {
  const art = el('div', { class: 'peek-art', style: `--accent:${game.accent}` });
  art.innerHTML = glyphSVG(game.art, 96);
  const notes = el('ul', { class: 'peek-notes' });
  for (const n of game.teaser.notes) notes.append(el('li', {}, n));
  openSheet(
    el(
      'div',
      { class: 'peek' },
      art,
      el('h2', { class: 'peek-title' }, game.name),
      el('p', { class: 'peek-badge' }, `${game.players} · ${game.mode.toUpperCase()} · COMING SOON`),
      el('p', { class: 'peek-twist' }, game.teaser.twist),
      notes,
      el('p', { class: 'peek-foot' }, 'Follow the build in the Field Guide.'),
    ),
  );
}

function openJoin(): void {
  const input = el('input', {
    id: 'join-code',
    class: 'join-input',
    maxlength: '4',
    placeholder: 'CODE',
    autocomplete: 'off',
    inputmode: 'text',
    autocapitalize: 'characters',
  }) as HTMLInputElement;
  const status = el('p', { class: 'join-status' });
  const go = el('button', { class: 'chip-btn primary', type: 'submit' }, 'JOIN');
  const form = el(
    'form',
    { class: 'join-form' },
    el('h2', { class: 'peek-title' }, 'Join a room'),
    el('p', { class: 'peek-twist' }, 'Got a 4-letter code from a buddy? Type it in.'),
    el('div', { class: 'join-row' }, input, go),
    status,
  ) as HTMLFormElement;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = input.value.trim().toUpperCase();
    if (!ROOM_CODE.test(code)) {
      status.textContent = 'Codes are 4 letters, like BLAB.';
      return;
    }
    status.textContent = 'finding your room…';
    // Ask the server which game this code belongs to (>1 game is live now), and
    // fall back to a sole live game if the lookup is unreachable.
    void gameForRoom(code).then((game) => {
      const route =
        (game !== null ? joinRouteForGame(game, code) : null) ?? resolveJoinRoute(code);
      if (!route) {
        status.textContent = "couldn't find that room — check the code, or use the invite link.";
        return;
      }
      location.href = route;
    });
  });
  openSheet(form);
  input.focus();
}

// --- Boot ---

export function boot(): void {
  applyInputMode();
  const grid = document.querySelector<HTMLElement>('#game-grid');
  if (grid) for (const g of GAMES) grid.append(tile(g));
  document.querySelector<HTMLButtonElement>('#join-chip')?.addEventListener('click', openJoin);
}

boot();
