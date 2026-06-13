/**
 * Online play entry (/play/bubble-buddies?room=CODE): join the room over
 * WebSocket, run prediction + interpolation via RoomClient/NetView, and
 * wire the invite flow, touch controls, and emote wheel. `?lag=150` adds
 * the artificial-latency harness for feel-tuning.
 */
import './shell/shell.css';
import { Canvas2DRenderer } from '@retro-recall/retrokit/render';
import { KeyboardInput } from '@retro-recall/retrokit/input';
import { startLoop } from '@retro-recall/retrokit/loop';
import { Button } from '@retro-recall/retrokit/sim';
import {
  LagTransport,
  RoomClient,
  WebSocketTransport,
  type EmoteKind,
  type Transport,
} from '@retro-recall/netcode';
import { LEVEL_HEIGHT, LEVEL_WIDTH, TILE_SIZE } from './sim/constants';
import { BubbleBuddiesSim } from './sim/sim';
import { render, SLOT_COLORS } from './render/index';
import { NetView, levelMap } from './net/view';
import { EmoteWheel, EMOTE_GLYPHS } from './shell/emote-wheel';
import { AvatarStore, type AvatarSprite } from './avatar/store';
import { setupAvatarPicker } from './avatar/picker';
import { createTouchControls, type TouchControls } from './shell/controls';
import { applyInputMode } from './shell/device';
import { startLayout } from './shell/layout';
import { unlockAudio } from './shell/audio';
import { registerServiceWorker } from './shell/pwa';
import {
  createRoom,
  escapeToBrowser,
  fetchRoomInfo,
  isInAppBrowser,
  isRoomCodeLike,
  shareInvite,
  wsUrl,
} from './shell/invite';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

const params = new URLSearchParams(location.search);
const lagMs = Number(params.get('lag') ?? 0);

async function resolveRoomCode(): Promise<string> {
  const fromUrl = (params.get('room') ?? '').toUpperCase();
  if (isRoomCodeLike(fromUrl)) return fromUrl;
  // No room in the URL ("play online" from the home page): create one.
  const { code } = await createRoom();
  const url = new URL(location.href);
  url.searchParams.set('room', code);
  history.replaceState(null, '', url);
  return code;
}

function statusLine(text: string, bad = false): void {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('bad', bad);
}

async function main(): Promise<void> {
  const inputMode = applyInputMode();
  registerServiceWorker();

  // In-app browser escape (ADR-008): show before anything else.
  if (isInAppBrowser()) {
    $('#inapp-banner').classList.remove('hidden');
    $('#escape-browser').addEventListener('click', () => {
      escapeToBrowser();
      setTimeout(() => $('#escape-fallback').classList.remove('hidden'), 1200);
    });
  }

  const code = await resolveRoomCode();
  $('#room-code').textContent = code;
  $('#overlay-code').textContent = code;
  statusLine('');

  $('#share').addEventListener('click', () => {
    const url = new URL(location.href);
    url.search = `?room=${code}`;
    void shareInvite(url.toString()).then((how) =>
      statusLine(how === 'copied' ? 'link copied — paste it into the call chat' : ''),
    );
  });

  // Pre-join roster so you can see who's already in.
  const info = await fetchRoomInfo(code);
  if (info === null) {
    $('#name-overlay').innerHTML =
      '<div class="banner warn">this room has expired — go back and start a new one</div>';
    return;
  }
  if (info.players.length > 0) {
    $('#room-roster').textContent =
      `already here: ${info.players.map((p) => p.name).join(', ')}`;
  }

  // Avatar picker: a buddy is always pre-selected, so JOIN is never blocked.
  const avatars = new AvatarStore();
  const picker = setupAvatarPicker(
    {
      options: $('#avatar-options'),
      photoBtn: $<HTMLButtonElement>('#photo-btn'),
      fileInput: $<HTMLInputElement>('#photo-input'),
      status: $('#avatar-status'),
    },
    avatars,
    code,
  );

  const nameInput = $<HTMLInputElement>('#name-input');
  nameInput.value = localStorage.getItem('bb-name') ?? '';
  await new Promise<void>((resolve) => {
    const go = (): void => {
      if (nameInput.value.trim().length === 0) nameInput.value = 'Buddy';
      // The join tap is our user gesture — it doubles as the iOS audio unlock.
      unlockAudio();
      resolve();
    };
    $('#join-btn').addEventListener('click', go);
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
  });
  const playerName = nameInput.value.trim().slice(0, 12);
  localStorage.setItem('bb-name', playerName);
  const avatarId = picker.getAvatarId();
  $('#name-overlay').classList.add('hidden');

  // --- Netcode client ---
  const tokenKey = `bb-token-${code}`;
  const makeTransport = (): Transport => {
    const ws: Transport = new WebSocketTransport(wsUrl(code));
    return lagMs > 0 ? new LagTransport(ws, { delayMs: lagMs }) : ws;
  };

  let reconnectTries = 0;
  const client = new RoomClient<BubbleBuddiesSim>({
    connect: makeTransport,
    createSim: () => new BubbleBuddiesSim(0, 0, 0),
    playerName,
    avatarId,
    rejoinToken: sessionStorage.getItem(tokenKey) ?? undefined,
    onEvent: (ev) => {
      if (ev.kind === 'status') {
        if (ev.status === 'active') {
          reconnectTries = 0;
          sessionStorage.setItem(tokenKey, client.rejoinToken ?? '');
          statusLine('');
        } else if (ev.status === 'connecting') {
          statusLine('connecting…');
        } else if (ev.status === 'full') {
          statusLine('room is full (4 players + 4 watchers)', true);
        } else if (ev.status === 'disconnected') {
          if (reconnectTries < 8) {
            reconnectTries++;
            statusLine(`connection lost — reconnecting (try ${reconnectTries})…`, true);
            setTimeout(() => client.reconnect(), 1200 * reconnectTries);
          } else {
            statusLine('disconnected — reload to rejoin', true);
          }
        }
      } else if (ev.kind === 'peers') {
        for (const peer of ev.slots) avatars.ensure(peer?.avatarId);
        renderRoster();
      } else if (ev.kind === 'desync') {
        console.warn(`[netcode] desync at tick ${ev.tick} — filed in client.desyncs`);
      }
    },
  });
  client.start();

  // --- Shell: canvas, layout, inputs, touch, emote wheel ---
  const canvas = $<HTMLCanvasElement>('#game');
  // displayScale 1: the layout engine owns the CSS size (integer device-pixel
  // multiples of 256×192, per ADR-007).
  const renderer = new Canvas2DRenderer(canvas, LEVEL_WIDTH * TILE_SIZE, LEVEL_HEIGHT * TILE_SIZE, 1);
  const keyboard = new KeyboardInput(window);
  const wheel = new EmoteWheel(document.body, (kind: EmoteKind) => client.sendEmote(kind));
  let touch: TouchControls | null = null;
  if (inputMode === 'touch') {
    touch = createTouchControls($('#dpad'), $('#abzone'), {
      // Release is also handled by the wheel's global pointerup listener;
      // wheel.release() is idempotent so the double call is harmless.
      onB: (down) => (down ? wheel.holdStart() : wheel.release()),
    });
  }
  startLayout(
    {
      arena: $('#arena'),
      playfield: canvas,
      hud: $('#hud'),
      dpad: $('#dpad'),
      buttons: $('#abzone'),
      keysHint: document.querySelector<HTMLElement>('.keys'),
    },
    { touch: inputMode === 'touch' },
  );
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyX') wheel.holdStart();
    if (wheel.isOpen) {
      if (e.code === 'ArrowRight' || e.code === 'ArrowDown') wheel.step(1);
      if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') wheel.step(-1);
      if (e.code === 'Escape') wheel.cancel();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyX') wheel.release();
  });

  const view = new NetView(client);

  const renderRoster = (): void => {
    const el = $('#players');
    el.innerHTML = '';
    client.peers.forEach((p, slot) => {
      if (!p) return;
      const span = document.createElement('span');
      span.textContent = `● ${p.name}`;
      span.style.color = SLOT_COLORS[slot]!.body;
      if (slot === client.slot) span.classList.add('me');
      if (!p.connected) span.classList.add('off');
      el.append(span);
    });
    if (client.spectators > 0) {
      const span = document.createElement('span');
      span.textContent = `+${client.spectators} watching`;
      el.append(span);
    }
  };

  startLoop({
    tick: () => {
      let bits = keyboard.sample() | (touch?.sample() ?? 0);
      // While the wheel is open, the pad navigates the wheel, not the buddy.
      if (wheel.isOpen) bits &= Button.B;
      client.localTick(bits);
    },
    render: () => {
      const state = view.frame(performance.now());
      if (!state) return;
      const emoteGlyphs = new Map<number, string>();
      for (const [slot, e] of client.emotes) emoteGlyphs.set(slot, EMOTE_GLYPHS[e.kind]);
      const sprites = new Map<number, AvatarSprite>();
      client.peers.forEach((peer, slot) => {
        const s = avatars.get(peer?.avatarId);
        if (s) sprites.set(slot, s);
      });
      render(renderer, levelMap(state.level), state, {
        localSlot: client.slot,
        emotes: emoteGlyphs,
        sprites,
      });
      if (client.status === 'active') {
        const me = client.slot >= 0 ? state.players[client.slot] : null;
        if (client.spectator) {
          statusLine('watching — player seats are full');
        } else if (me && me.phase === 'pending') {
          statusLine("you're in! you join the action when the next level starts");
        } else if (me && me.phase === 'bubble') {
          statusLine('trapped! a buddy can bump your bubble to free you');
        } else {
          statusLine(`ping ${Math.round(client.rttMs)}ms`);
        }
      }
    },
  });
}

void main().catch((err: unknown) => {
  statusLine(String(err), true);
});
