import { describe, expect, it } from 'vitest';
import { INPUT_KEEPALIVE_TICKS } from '../src/protocol';
import { RoomClient } from '../src/client/room-client';
import type { Transport } from '../src/client/transport';
import type { NetSim } from '../src/room/core';

/** Minimal sim: just a tick counter the client can restore and advance. */
class MiniSim implements NetSim {
  state = { tick: 0, mode: 'playing' };
  tick(): void {
    this.state.tick++;
  }
  serialize(): string {
    return JSON.stringify(this.state);
  }
  hash(): number {
    return 0;
  }
  snapshot(): string {
    return JSON.stringify(this.state);
  }
  restore(json: string): void {
    this.state = JSON.parse(json) as MiniSim['state'];
  }
  joinPlayer(): void {}
  rejoinPlayer(): void {}
}

/** Captures everything the client sends; lets the test feed messages back. */
class FakeTransport implements Transport {
  onOpen: (() => void) | null = null;
  onMessage: ((data: string) => void) | null = null;
  onClose: (() => void) | null = null;
  readonly sent: Record<string, unknown>[] = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {}
  inputs(): Record<string, unknown>[] {
    return this.sent.filter((m) => m['type'] === 'input');
  }
}

/** Start a client and walk it to `active` via the welcome handshake. */
const activeClient = (spectator = false): { client: RoomClient<MiniSim>; t: FakeTransport } => {
  const t = new FakeTransport();
  const client = new RoomClient<MiniSim>({
    connect: () => t,
    createSim: () => new MiniSim(),
    playerName: 'p',
  });
  client.start();
  t.onOpen?.();
  t.onMessage?.(
    JSON.stringify({
      type: 'welcome',
      slot: spectator ? -1 : 0,
      spectator,
      rejoinToken: 'tok',
      tick: 0,
      snapshot: JSON.stringify({ tick: 0, mode: 'playing' }),
    }),
  );
  return { client, t };
};

describe('RoomClient input sending', () => {
  it('sends input only on change, plus a keepalive floor (not every tick)', () => {
    const { client, t } = activeClient();
    const HELD = 7;
    const TICKS = 3 * INPUT_KEEPALIVE_TICKS; // 90 ticks holding the same pad
    for (let i = 0; i < TICKS; i++) client.localTick(HELD);

    const inputs = t.inputs();
    // Streaming every tick would be 90 messages; change+keepalive is a handful.
    expect(inputs.length).toBeLessThan(TICKS);
    expect(inputs.length).toBeLessThanOrEqual(Math.ceil(TICKS / INPUT_KEEPALIVE_TICKS) + 1);
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    // Every input carries the held bits and no `prev` redundancy.
    for (const m of inputs) {
      expect(m['bits']).toBe(HELD);
      expect(m['prev']).toBeUndefined();
    }
  });

  it('sends on every genuine change', () => {
    const { client, t } = activeClient();
    const pads = [1, 2, 2, 3, 0, 0, 4];
    for (const bits of pads) client.localTick(bits);
    // One message per distinct transition: 1,2,3,0,4 → 5 (repeats coalesced).
    expect(t.inputs().map((m) => m['bits'])).toEqual([1, 2, 3, 0, 4]);
  });

  it('spectators never send input', () => {
    const { client, t } = activeClient(true);
    for (let i = 0; i < 50; i++) client.localTick(7);
    expect(t.inputs()).toHaveLength(0);
  });
});
