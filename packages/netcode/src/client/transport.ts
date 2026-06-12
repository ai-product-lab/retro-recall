/**
 * Client transport: a thin, swappable wrapper over WebSocket so tests can
 * inject in-memory pipes and dev builds can inject artificial latency/loss
 * (`?lag=150` harness — see SPEC.md).
 */

export interface Transport {
  send(data: string): void;
  close(): void;
  onOpen: (() => void) | null;
  onMessage: ((data: string) => void) | null;
  onClose: (() => void) | null;
}

export class WebSocketTransport implements Transport {
  onOpen: (() => void) | null = null;
  onMessage: ((data: string) => void) | null = null;
  onClose: (() => void) | null = null;
  private ws: WebSocket;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.onOpen?.();
    this.ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.onMessage?.(e.data);
    };
    this.ws.onclose = () => this.onClose?.();
    this.ws.onerror = () => this.ws.close();
  }

  send(data: string): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  close(): void {
    this.ws.close();
  }
}

export interface LagOptions {
  /** One-way delay in ms. */
  delayMs: number;
  /** Extra random jitter in ms (uniform 0..jitterMs). */
  jitterMs?: number;
  /** Fraction of input/emote messages dropped (redundancy should cover it). */
  loss?: number;
  /** Injectable scheduler/randomness for tests. */
  schedule?: (fn: () => void, ms: number) => void;
  random?: () => number;
}

/** Lossy messages — everything else (join/ping/resync) is never dropped. */
const DROPPABLE = /"type":"(input|emote)"/;

/** Wrap a transport with artificial latency + loss, both directions. */
export class LagTransport implements Transport {
  onOpen: (() => void) | null = null;
  onMessage: ((data: string) => void) | null = null;
  onClose: (() => void) | null = null;
  private readonly inner: Transport;
  private readonly o: Required<LagOptions>;

  constructor(inner: Transport, opts: LagOptions) {
    this.inner = inner;
    this.o = {
      delayMs: opts.delayMs,
      jitterMs: opts.jitterMs ?? Math.floor(opts.delayMs / 4),
      loss: opts.loss ?? 0.05,
      schedule: opts.schedule ?? ((fn, ms) => setTimeout(fn, ms)),
      random: opts.random ?? Math.random,
    };
    inner.onOpen = () => this.delay(() => this.onOpen?.());
    inner.onMessage = (data) => {
      if (this.drop(data)) return;
      this.delay(() => this.onMessage?.(data));
    };
    inner.onClose = () => this.delay(() => this.onClose?.());
  }

  private drop(data: string): boolean {
    return this.o.loss > 0 && DROPPABLE.test(data) && this.o.random() < this.o.loss;
  }

  private delay(fn: () => void): void {
    this.o.schedule(fn, this.o.delayMs + this.o.random() * this.o.jitterMs);
  }

  send(data: string): void {
    if (this.drop(data)) return;
    this.delay(() => this.inner.send(data));
  }

  close(): void {
    this.inner.close();
  }
}
