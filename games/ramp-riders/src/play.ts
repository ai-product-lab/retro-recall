/**
 * Online play entry (/play/ramp-riders?room=CODE): join the room over
 * WebSocket, run prediction + interpolation via RoomClient/NetView, render the
 * camera-scrolled race, and wire roster / invite / reconnect. `?lag=150` adds
 * the artificial-latency harness for feel-tuning. Server-authoritative
 * (ADR-003); each client predicts its own rider and interpolates rivals.
 */
import './shell/shell.css';
import { Canvas2DRenderer } from '@retro-recall/retrokit/render';
import { startLoop } from '@retro-recall/retrokit/loop';
import { Button } from '@retro-recall/retrokit/sim';
import { LagTransport, RoomClient, WebSocketTransport, type Transport } from '@retro-recall/netcode';
import { RampRidersSim } from './sim/sim';
import { RampRidersView } from './render/index';
import { NetView } from './net/view';
import { GAME_W, GAME_H, layoutCanvas, mountControls } from './shell/layout';
import { createRoom, fetchRoomInfo, isRoomCodeLike, shareInvite, wsUrl } from './shell/invite';

const SLOT_COLORS = ['#ff6b6b', '#4cc9f0', '#ffd166', '#3df5a6'];
const KEYMAP: Record<string, number> = {
  KeyZ: Button.A,
  KeyX: Button.B,
  ArrowUp: Button.Up,
  ArrowDown: Button.Down,
  ArrowLeft: Button.Left,
  ArrowRight: Button.Right,
  Enter: Button.Start,
};

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

const params = new URLSearchParams(location.search);
const lagMs = Number(params.get('lag') ?? 0);

function statusLine(text: string, bad = false): void {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('bad', bad);
}

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
  const code = await resolveRoomCode();
  $('#room-code').textContent = code;
  $('#overlay-code').textContent = code;
  statusLine('');

  $('#share').addEventListener('click', () => {
    const url = new URL(location.href);
    url.search = `?room=${code}`;
    void shareInvite(url.toString()).then((how) =>
      statusLine(how === 'copied' ? 'link copied — paste it in the call chat' : ''),
    );
  });

  const info = await fetchRoomInfo(code);
  if (info && info.players.length > 0) {
    $('#roster-pre').textContent = `already here: ${info.players.map((p) => p.name).join(', ')}`;
  }

  // Name → join (the tap is our user gesture).
  const nameInput = $<HTMLInputElement>('#name-input');
  nameInput.value = localStorage.getItem('rr-name') ?? '';
  await new Promise<void>((resolve) => {
    const go = (): void => {
      if (nameInput.value.trim().length === 0) nameInput.value = 'Rider';
      resolve();
    };
    $('#join-btn').addEventListener('click', go);
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
  });
  const playerName = nameInput.value.trim().slice(0, 12);
  localStorage.setItem('rr-name', playerName);
  $('#name-overlay').classList.add('hidden');

  // --- Netcode client ---
  const tokenKey = `rr-token-${code}`;
  const makeTransport = (): Transport => {
    const ws: Transport = new WebSocketTransport(wsUrl(code));
    return lagMs > 0 ? new LagTransport(ws, { delayMs: lagMs }) : ws;
  };

  let reconnectTries = 0;
  const client = new RoomClient<RampRidersSim>({
    connect: makeTransport,
    createSim: () => new RampRidersSim(0),
    playerName,
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
          statusLine('room is full (4 riders + 4 watchers)', true);
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

  // --- Shell ---
  const canvas = $<HTMLCanvasElement>('#game');
  const renderer = new Canvas2DRenderer(canvas, GAME_W, GAME_H, 1);
  const view = new RampRidersView();
  const net = new NetView(client);
  layoutCanvas(canvas);
  window.addEventListener('resize', () => layoutCanvas(canvas));

  const touchInput = mountControls($('#controls'));
  let keyBits = 0;
  window.addEventListener('keydown', (e) => {
    const bit = KEYMAP[e.code];
    if (bit) {
      keyBits |= bit;
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    const bit = KEYMAP[e.code];
    if (bit) keyBits &= ~bit;
  });

  function renderRoster(): void {
    const el = $('#riders');
    el.innerHTML = '';
    client.peers.forEach((p, slot) => {
      if (!p) return;
      const span = document.createElement('span');
      span.textContent = `● ${p.name}`;
      span.style.color = SLOT_COLORS[slot]!;
      if (slot === client.slot) span.style.fontWeight = 'bold';
      if (!p.connected) span.style.opacity = '0.5';
      el.append(span);
    });
    if (client.spectators > 0) {
      const span = document.createElement('span');
      span.textContent = `+${client.spectators} watching`;
      span.style.opacity = '0.7';
      el.append(span);
    }
  }

  startLoop({
    tick: () => {
      client.localTick(keyBits | touchInput());
    },
    render: () => {
      const state = net.frame(performance.now());
      if (!state) return;
      view.render(renderer, state, client.slot >= 0 ? client.slot : 0);
      if (client.status === 'active') {
        const me = client.slot >= 0 ? state.players[client.slot] : null;
        if (client.spectator) statusLine('watching — rider seats are full');
        else if (me && me.phase === 'pending') statusLine("you're in! you race when the next one starts");
        else statusLine(`ping ${Math.round(client.rttMs)}ms`);
      }
    },
  });
}

void main().catch((err: unknown) => {
  statusLine(String(err), true);
});
