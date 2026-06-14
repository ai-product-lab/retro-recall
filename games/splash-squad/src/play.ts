/**
 * Online co-op entry (/play/splash-squad?room=CODE). Joins the room over
 * WebSocket, runs prediction + interpolation via RoomClient/NetView, and feeds
 * the same NES bitmask the keyboard + touch produce. Pure co-op, server-
 * authoritative (ADR-003) — identical transport to Bubble Buddies.
 *
 * v1 keeps the lobby minimal; the richer comms shell (emote wheel, in-app-
 * browser escape, PWA install) is ADR-008 infrastructure to share across games
 * rather than re-author per game.
 */
import './shell/shell.css';
import { Canvas2DRenderer } from '@retro-recall/retrokit/render';
import { KeyboardInput } from '@retro-recall/retrokit/input';
import { startLoop } from '@retro-recall/retrokit/loop';
import { LagTransport, RoomClient, WebSocketTransport, type Transport } from '@retro-recall/netcode';
import { SCREEN_H, SCREEN_W } from './sim/constants';
import { SplashSquadSim } from './sim/sim';
import { render } from './render/index';
import { NetView } from './net/view';
import { AvatarStore, type AvatarSprite } from './avatar/store';
import { setupAvatarPicker } from './avatar/picker';
import {
  applyInputMode,
  createTouchControls,
  installZoomGuard,
  resumeAudioOnVisible,
  startLayout,
  type TouchControls,
} from '@retro-recall/shell';
import { audioContext, unlockAudio } from './shell/audio';
import { SfxObserver } from './shell/sfx';
import { createRoom, fetchRoomInfo, isRoomCodeLike, shareInvite, wsUrl } from './shell/invite';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

const params = new URLSearchParams(location.search);
const lagMs = Number(params.get('lag') ?? 0);

const status = (text: string, bad = false): void => {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('bad', bad);
};

async function resolveRoomCode(): Promise<string> {
  const fromUrl = (params.get('room') ?? '').toUpperCase();
  if (isRoomCodeLike(fromUrl)) return fromUrl;
  const { code } = await createRoom();
  const url = new URL(location.href);
  url.searchParams.set('room', code);
  history.replaceState(null, '', url);
  return code;
}

async function main(): Promise<void> {
  const inputMode = applyInputMode();
  installZoomGuard(); // kill double-tap / pinch zoom across the whole play route
  resumeAudioOnVisible(audioContext); // sound shouldn't die after backgrounding
  const code = await resolveRoomCode();
  $('#room-code').textContent = code;

  // Re-surface the lobby overlay with a retry on a dead-end (full / gave up).
  const showFatal = (title: string, detail: string): void => {
    const overlay = $('#name-overlay');
    overlay.innerHTML =
      `<h1>${title}</h1><p>${detail}</p>` +
      `<button id="retry-btn">Try again</button>`;
    overlay.classList.remove('hidden');
    $('#retry-btn').addEventListener('click', () => location.reload());
  };

  $('#share').addEventListener('click', () => {
    const url = new URL(location.href);
    url.search = `?room=${code}`;
    void shareInvite(url.toString()).then((how) => {
      if (how === 'copied') status('link copied — paste it into the call chat');
      else if (how === 'failed') status('couldn’t copy — long-press the address bar to share', true);
      else status('');
    });
  });

  const info = await fetchRoomInfo(code);
  if (info && info.players.length > 0) {
    $('#roster').textContent = `already here: ${info.players.map((p) => p.name).join(', ')}`;
  }

  // Avatar picker: a buddy is always pre-selected, so JOIN is never blocked (a
  // gallery creature stands in when there's no camera / worker / photo).
  const avatars = new AvatarStore();
  const picker = setupAvatarPicker(
    {
      options: $('#avatar-options'),
      photoBtn: $<HTMLButtonElement>('#avatar-photo'),
      fileInput: $<HTMLInputElement>('#avatar-file'),
      status: $('#avatar-status'),
    },
    avatars,
    code,
  );

  const nameInput = $<HTMLInputElement>('#name-input');
  nameInput.value = localStorage.getItem('ss-name') ?? '';
  await new Promise<void>((resolve) => {
    const go = (): void => {
      if (nameInput.value.trim().length === 0) nameInput.value = 'Squaddie';
      unlockAudio(); // the join tap doubles as the iOS audio-unlock gesture
      resolve();
    };
    $('#join-btn').addEventListener('click', go);
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
  });
  const playerName = nameInput.value.trim().slice(0, 12);
  localStorage.setItem('ss-name', playerName);
  const avatarId = picker.getAvatarId();
  avatars.ensure(avatarId); // warm your own buddy before the first frame
  $('#name-overlay').classList.add('hidden');

  const tokenKey = `ss-token-${code}`;
  const makeTransport = (): Transport => {
    const ws: Transport = new WebSocketTransport(wsUrl(code));
    return lagMs > 0 ? new LagTransport(ws, { delayMs: lagMs }) : ws;
  };

  let reconnectTries = 0;
  let reconnectTimer = 0;
  const client = new RoomClient<SplashSquadSim>({
    connect: makeTransport,
    createSim: () => new SplashSquadSim(0, 0, 0),
    playerName,
    avatarId,
    rejoinToken: sessionStorage.getItem(tokenKey) ?? undefined,
    onEvent: (ev) => {
      if (ev.kind === 'peers') {
        for (const peer of ev.slots) avatars.ensure(peer?.avatarId); // warm teammates' buddies
        return;
      }
      if (ev.kind !== 'status') return;
      if (ev.status === 'active') {
        reconnectTries = 0;
        sessionStorage.setItem(tokenKey, client.rejoinToken ?? '');
        status('');
      } else if (ev.status === 'connecting') {
        status('connecting…');
      } else if (ev.status === 'full') {
        status('room is full (4 players + 4 watchers)', true);
        showFatal('This room is full', 'It already has 4 players and 4 watchers.');
      } else if (ev.status === 'disconnected') {
        if (reconnectTries < 8) {
          reconnectTries++;
          status(`connection lost — reconnecting (try ${reconnectTries})…`, true);
          clearTimeout(reconnectTimer);
          reconnectTimer = window.setTimeout(() => client.reconnect(), 1200 * reconnectTries);
        } else {
          status('disconnected — reload to rejoin', true);
          showFatal('Disconnected', 'We couldn’t reach the room after several tries.');
        }
      }
    },
  });
  client.start();

  const canvas = $<HTMLCanvasElement>('#game');
  const renderer = new Canvas2DRenderer(canvas, SCREEN_W, SCREEN_H, 1);
  const keyboard = new KeyboardInput(window);
  let touch: TouchControls | null = null;
  if (inputMode === 'touch') touch = createTouchControls($('#dpad'), $('#abzone'));

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

  const view = new NetView(client);
  const sfx = new SfxObserver();
  startLoop({
    tick: () => client.localTick(keyboard.sample() | (touch?.sample() ?? 0)),
    render: () => {
      const v = view.frame(performance.now());
      if (v) {
        const sprites = new Map<number, AvatarSprite>();
        client.peers.forEach((peer, slot) => {
          const s = avatars.get(peer?.avatarId);
          if (s) sprites.set(slot, s);
        });
        render(renderer, v, { localSlot: client.slot, sprites });
        sfx.observe(v);
      }
    },
  });
}

void main();
