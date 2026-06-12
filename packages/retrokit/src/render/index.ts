/**
 * Minimal Canvas 2D renderer. Works in logical pixels (e.g. 256×192) on a
 * backing canvas of that exact size; CSS + image-rendering:pixelated scale it
 * up crisply. Render code may use floats freely — it never feeds the sim.
 */
export class Canvas2DRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;

  constructor(canvas: HTMLCanvasElement, width: number, height: number, displayScale = 3) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width * displayScale}px`;
    canvas.style.height = `${height * displayScale}px`;
    canvas.style.imageRendering = 'pixelated';
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
  }

  clear(color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  circle(cx: number, cy: number, r: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
    this.ctx.fill();
  }

  circleOutline(cx: number, cy: number, r: number, color: string, lineWidth = 1): void {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lineWidth;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  text(str: string, x: number, y: number, color: string, size = 8, align: CanvasTextAlign = 'left'): void {
    this.ctx.fillStyle = color;
    this.ctx.font = `${size}px monospace`;
    this.ctx.textAlign = align;
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(str, x, y);
  }
}
