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
import { applyInputMode } from './shell/device';
import { startLayout } from './shell/layout';
import { createTouchControls, type TouchControls } from './shell/controls';
import { unlockAudio } from './shell/audio';
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
  const code = await resolveRoomCode();
  $('#room-code').textContent = code;

  $('#share').addEventListener('click', () => {
    const url = new URL(location.href);
    url.search = `?room=${code}`;
    void shareInvite(url.toString()).then((how) =>
      status(how === 'copied' ? 'link copied — paste it into the call chat' : ''),
    );
  });

  const info = await fetchRoomInfo(code);
  if (info && info.players.length > 0) {
    $('#roster').textContent = `already here: ${info.players.map((p) => p.name).join(', ')}`;
  }

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
  $('#name-overlay').classList.add('hidden');

  const tokenKey = `ss-token-${code}`;
  const makeTransport = (): Transport => {
    const ws: Transport = new WebSocketTransport(wsUrl(code));
    return lagMs > 0 ? new LagTransport(ws, { delayMs: lagMs }) : ws;
  };

  let reconnectTries = 0;
  const client = new RoomClient<SplashSquadSim>({
    connect: makeTransport,
    createSim: () => new SplashSquadSim(0, 0, 0),
    playerName,
    rejoinToken: sessionStorage.getItem(tokenKey) ?? undefined,
    onEvent: (ev) => {
      if (ev.kind !== 'status') return;
      if (ev.status === 'active') {
        reconnectTries = 0;
        sessionStorage.setItem(tokenKey, client.rejoinToken ?? '');
        status('');
      } else if (ev.status === 'connecting') {
        status('connecting…');
      } else if (ev.status === 'full') {
        status('room is full (4 players + 4 watchers)', true);
      } else if (ev.status === 'disconnected') {
        if (reconnectTries < 8) {
          reconnectTries++;
          status(`connection lost — reconnecting (try ${reconnectTries})…`, true);
          setTimeout(() => client.reconnect(), 1200 * reconnectTries);
        } else {
          status('disconnected — reload to rejoin', true);
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
        render(renderer, v);
        sfx.observe(v);
      }
    },
  });
}

void main();
