/**
 * Online play entry (/play/ramp-riders?room=CODE): join the room over
 * WebSocket, run prediction + interpolation via RoomClient/NetView, render the
 * camera-scrolled race, and wire roster / invite / reconnect. Landscape-only
 * 16:9 with the analog stick + overlaid fading controls (ADR-012). `?lag=150`
 * adds the artificial-latency harness. Server-authoritative (ADR-003).
 */
import './shell/shell.css';
import '@retro-recall/shell/controls.css';
import { Canvas2DRenderer } from '@retro-recall/retrokit/render';
import { startLoop } from '@retro-recall/retrokit/loop';
import { Button } from '@retro-recall/retrokit/sim';
import { LagTransport, RoomClient, WebSocketTransport, type Transport } from '@retro-recall/netcode';
import { RampRidersSim } from './sim/sim';
import { RampRidersView } from './render/index';
import { NetView } from './net/view';
import { VIEW_W, VIEW_H } from './sim/constants';
import {
  applyInputMode,
  createTouchControls,
  installZoomGuard,
  lockLandscapeOnGesture,
  requireLandscape,
  startLayout,
  type TouchControls,
} from '@retro-recall/shell';
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
  installZoomGuard(); // kill double-tap / pinch zoom across the play route
  requireLandscape(); // portrait → "rotate your phone" gate
  const inputMode = applyInputMode();
  const code = await resolveRoomCode();
  $('#room-code').textContent = code;
  $('#overlay-code').textContent = code;
  statusLine('');

  // Re-surface the lobby overlay with a retry on a dead-end (full / gave up).
  const showFatal = (title: string, detail: string): void => {
    const overlay = $('#name-overlay');
    overlay.innerHTML =
      `<div class="overlay-card"><div class="joining"><strong>${title}</strong><br />${detail}</div>` +
      `<button id="retry-btn" class="chip-btn primary">Try again</button></div>`;
    overlay.classList.remove('hidden');
    $('#retry-btn').addEventListener('click', () => location.reload());
  };

  $('#share').addEventListener('click', () => {
    const url = new URL(location.href);
    url.search = `?room=${code}`;
    void shareInvite(url.toString()).then((how) => {
      if (how === 'copied') statusLine('link copied — paste it in the call chat');
      else if (how === 'failed') statusLine('couldn’t copy — long-press the address bar to share', true);
      else statusLine('');
    });
  });

  const info = await fetchRoomInfo(code);
  if (info && info.players.length > 0) {
    $('#roster-pre').textContent = `already here: ${info.players.map((p) => p.name).join(', ')}`;
  }

  // Name → join (the tap is our user gesture — also the orientation-lock attempt).
  const nameInput = $<HTMLInputElement>('#name-input');
  nameInput.value = localStorage.getItem('rr-name') ?? '';
  await new Promise<void>((resolve) => {
    const go = (): void => {
      if (nameInput.value.trim().length === 0) nameInput.value = 'Rider';
      void lockLandscapeOnGesture();
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
  let reconnectTimer = 0;
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
          showFatal('This room is full', 'It already has 4 riders and 4 watchers.');
        } else if (ev.status === 'disconnected') {
          if (reconnectTries < 8) {
            reconnectTries++;
            statusLine(`connection lost — reconnecting (try ${reconnectTries})…`, true);
            clearTimeout(reconnectTimer);
            reconnectTimer = window.setTimeout(() => client.reconnect(), 1200 * reconnectTries);
          } else {
            statusLine('disconnected — reload to rejoin', true);
            showFatal('Disconnected', 'We couldn’t reach the room after several tries.');
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

  // --- Shell: full-bleed canvas, analog stick + PEDAL/PUMP, overlaid + fading ---
  const canvas = $<HTMLCanvasElement>('#game');
  const renderer = new Canvas2DRenderer(canvas, VIEW_W, VIEW_H, 1);
  const view = new RampRidersView();
  const net = new NetView(client);

  const stick = $<HTMLElement>('#stick');
  const abzone = $<HTMLElement>('#abzone');
  let touch: TouchControls | null = null;
  if (inputMode === 'touch') {
    touch = createTouchControls(stick, abzone, {
      buttons: [
        { label: 'PUMP', bit: Button.B, className: 'b' },
        { label: 'PEDAL', bit: Button.A, className: 'a' },
      ],
      fade: true,
    });
  }
  startLayout(
    { arena: $('#arena'), playfield: canvas, hud: $('#hud'), dpad: stick, buttons: abzone },
    { overlay: true, touch: inputMode === 'touch', logicalW: VIEW_W, logicalH: VIEW_H },
  );

  let keyBits = 0;
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLElement && e.target.tagName === 'INPUT') return;
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
      client.localTick(keyBits | (touch?.sample() ?? 0));
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
