/**
 * Webcam tracker: downsamples frames to a tiny canvas and derives four control signals (0..1):
 *   brightness — mean luma
 *   motion     — amount of frame-to-frame change
 *   x / y      — centroid of motion (mirrored so moving right = larger x; y: up = larger)
 * No external libraries; ~30 fps on a 32×24 buffer is negligible CPU.
 */
export interface CamMetrics {
  brightness: number;
  motion: number;
  x: number;
  y: number;
}

export type CamListener = (m: CamMetrics) => void;

const W = 32;
const H = 24;

export class CameraTracker {
  readonly video: HTMLVideoElement;
  readonly metrics: CamMetrics = { brightness: 0, motion: 0, x: 0.5, y: 0.5 };
  /** Number of vertical zones for per-zone motion (1..12). */
  zoneCols = 8;
  /** Smoothed per-zone motion, 0..1, index 0 = viewer's left (mirrored). */
  readonly zones = new Float32Array(12);
  private readonly zoneRaw = new Float32Array(12);
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private stream: MediaStream | null = null;
  private prev: Uint8ClampedArray | null = null;
  private raf = 0;
  private lastT = 0;
  private readonly listeners = new Set<CamListener>();

  constructor() {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  get running() {
    return this.stream !== null;
  }

  onFrame(fn: CamListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async start() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.prev = null;
    this.lastT = 0;
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  private tick(t: number) {
    this.raf = requestAnimationFrame((tt) => this.tick(tt));
    if (t - this.lastT < 33) return; // ~30 fps
    this.lastT = t;
    if (this.video.readyState < 2) return;

    this.ctx.drawImage(this.video, 0, 0, W, H);
    const data = this.ctx.getImageData(0, 0, W, H).data;
    const luma = new Uint8ClampedArray(W * H);
    let sum = 0;
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const l = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
      luma[j] = l;
      sum += l;
    }
    const brightness = sum / (W * H * 255);

    let motion = 0;
    let cx = 0;
    let cy = 0;
    let wsum = 0;
    const cols = Math.max(1, Math.min(12, this.zoneCols));
    this.zoneRaw.fill(0);
    if (this.prev) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const j = y * W + x;
          const d = Math.abs(luma[j] - this.prev[j]);
          if (d > 18) {
            const w = d;
            wsum += w;
            cx += x * w;
            cy += y * w;
            this.zoneRaw[Math.min(cols - 1, Math.floor(((W - 1 - x) / W) * cols))] += d;
          }
          motion += d;
        }
      }
    }
    this.prev = luma;
    motion = Math.min(1, motion / (W * H * 40));
    const zoneNorm = (H * (W / cols)) * 30;
    for (let z = 0; z < 12; z++) {
      const target = z < cols ? Math.min(1, this.zoneRaw[z] / zoneNorm) : 0;
      this.zones[z] += (target - this.zones[z]) * 0.45;
    }

    const m = this.metrics;
    const a = 0.25; // smoothing
    m.brightness += (brightness - m.brightness) * a;
    m.motion += (motion - m.motion) * a;
    if (wsum > 0) {
      const nx = 1 - cx / wsum / (W - 1); // mirrored
      const ny = 1 - cy / wsum / (H - 1);
      m.x += (nx - m.x) * a;
      m.y += (ny - m.y) * a;
    }
    for (const l of this.listeners) l(m);
  }
}
