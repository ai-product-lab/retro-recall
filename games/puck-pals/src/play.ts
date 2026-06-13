/**
 * Online play entry (/play/puck-pals?room=CODE): join the room over WebSocket,
 * run prediction + interpolation via RoomClient/NetView, and wire the invite
 * flow + touch controls. Versus, server-authoritative (ADR-003); the puck is
 * server-owned (SPEC §11). `?lag=150` adds the artificial-latency harness for
 * feel-tuning. See games/puck-pals/SPEC.md §11.
 */
import './shell/shell.css';
import { Canvas2DRenderer } from '@retro-recall/retrokit/render';
import { Camera } from '@retro-recall/retrokit/camera';
import { Button } from '@retro-recall/retrokit/sim';
import { LagTransport, RoomClient, WebSocketTransport, type Transport } from '@retro-recall/netcode';
import { PuckPalsSim } from './sim/sim';
import { render, followPuck, VIEW_W, VIEW_H } from './render/index';
import { NetView } from './net/view';
import { GAME_W, GAME_H, layoutCanvas, mountControls, type TouchPad } from './shell/layout';
import { applyInputMode } from './shell/device';
import { HeadStore, headResolver } from './avatar/heads';
import { setupAvatarPicker } from './avatar/picker';
import {
  createRoom,
  escapeToBrowser,
  fetchRoomInfo,
  isInAppBrowser,
  isRoomCodeLike,
  shareInvite,
  wsUrl,
} from './shell/invite';

const TICK_MS = 1000 / 60;
const KEYS: Record<string, number> = {
  ArrowLeft: Button.Left,
  ArrowRight: Button.Right,
  ArrowUp: Button.Up,
  ArrowDown: Button.Down,
  KeyZ: Button.A,
  KeyX: Button.B,
  Enter: Button.Start,
};

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

  // Pre-join roster so you can see who's already on the ice.
  const info = await fetchRoomInfo(code);
  if (info === null) {
    $('#name-overlay').innerHTML =
      '<div class="overlay-card"><div class="banner warn">this room has expired — go back and start a new one</div></div>';
    return;
  }
  if (info.players.length > 0) {
    $('#room-roster').textContent = `already here: ${info.players.map((p) => p.name).join(', ')}`;
  }

  // Avatar picker (gallery + photo) — there's always a valid pick, so JOIN is
  // never blocked even with no worker/camera.
  const heads = new HeadStore();
  const picker = setupAvatarPicker(
    {
      options: $('#avatar-options'),
      photoBtn: $<HTMLButtonElement>('#avatar-photo'),
      fileInput: $<HTMLInputElement>('#avatar-file'),
      status: $('#avatar-status'),
    },
    heads,
    code,
  );

  const nameInput = $<HTMLInputElement>('#name-input');
  nameInput.value = localStorage.getItem('pp-name') ?? '';
  await new Promise<void>((resolve) => {
    const go = (): void => {
      if (nameInput.value.trim().length === 0) nameInput.value = 'Skater';
      resolve();
    };
    $('#join-btn').addEventListener('click', go);
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
  });
  const playerName = nameInput.value.trim().slice(0, 12);
  const avatarId = picker.getAvatarId();
  localStorage.setItem('pp-name', playerName);
  localStorage.setItem('pp-avatar', avatarId); // carries over to solo practice
  $('#name-overlay').classList.add('hidden');

  // --- Netcode client ---
  const tokenKey = `pp-token-${code}`;
  const makeTransport = (): Transport => {
    const ws: Transport = new WebSocketTransport(wsUrl(code));
    return lagMs > 0 ? new LagTransport(ws, { delayMs: lagMs }) : ws;
  };

  let reconnectTries = 0;
  const client = new RoomClient<PuckPalsSim>({
    connect: makeTransport,
    createSim: () => new PuckPalsSim(0),
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
          statusLine('room is full (4 skaters + 4 watchers)', true);
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
        renderRoster();
      } else if (ev.kind === 'desync') {
        console.warn(`[netcode] desync at tick ${ev.tick} — filed in client.desyncs`);
      }
    },
  });
  client.start();

  // --- Shell: canvas, layout, input ---
  const canvas = $<HTMLCanvasElement>('#game');
  const renderer = new Canvas2DRenderer(canvas, GAME_W, GAME_H, 1);
  layoutCanvas(canvas);
  window.addEventListener('resize', () => layoutCanvas(canvas));

  let pad: TouchPad | null = null;
  if (inputMode === 'touch') pad = mountControls($('#controls'));

  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if (e.code in KEYS) {
      keys.add(e.code);
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  const keyboardBits = (): number => {
    let b = 0;
    for (const code of keys) if (code in KEYS) b |= KEYS[code]!;
    return b;
  };

  const cam = new Camera(VIEW_W, VIEW_H);
  const view = new NetView(client);

  // slot → avatarId from the roster (peers carry avatarId); our own slot uses
  // the local pick immediately so we never wait on a round-trip to see our face.
  const humanAvatars = (): Map<number, string> => {
    const m = new Map<number, string>();
    client.peers.forEach((p, slot) => {
      if (p?.avatarId) m.set(slot, p.avatarId);
    });
    if (client.slot >= 0) m.set(client.slot, avatarId);
    return m;
  };

  const renderRoster = (): void => {
    const el = $('#players');
    el.innerHTML = '';
    client.peers.forEach((p, slot) => {
      if (!p) return;
      const span = document.createElement('span');
      span.textContent = `${slot % 2 === 0 ? '🔵' : '🔴'} ${p.name}`;
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
  renderRoster();

  let acc = 0;
  let last = performance.now();
  const frame = (now: number): void => {
    acc += now - last;
    last = now;
    let steps = 0;
    const bits = keyboardBits() | (pad?.sample() ?? 0);
    while (acc >= TICK_MS && steps < 5) {
      client.localTick(bits);
      acc -= TICK_MS;
      steps++;
    }
    const state = view.frame(now);
    if (state) {
      followPuck(cam, state);
      const me = state.skaters.find((s) => s.slot === client.slot);
      render(renderer, state, cam, {
        localIds: me ? [me.id] : [],
        headFor: headResolver(heads, state.skaters, humanAvatars()),
      });
      pad?.setCarrying(!!me && state.puck.carrier === me.id);
      if (client.status === 'active') {
        if (client.spectator) statusLine('watching — skater seats are full');
        else statusLine(`ping ${Math.round(client.rttMs)}ms`);
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main().catch((err: unknown) => {
  statusLine(String(err), true);
});
