/// <reference types="@types/audioworklet" />
/**
 * FK-6 voice oscillator block (one per voice).
 *  - Osc1 / Osc2 with continuously variable shape (saw -> tri -> pulse), PWM, PolyBLEP anti-aliasing
 *  - Osc1 hard-synced to Osc2
 *  - Sub oscillator (square, one octave below Osc1), white noise
 *  - Mixer
 *  - "Slop": slow random pitch drift per oscillator (vintage feel)
 *
 * Outputs: 0 = mixed audio, 1 = raw Osc2 (poly-mod source)
 *
 * Also registers a small LFO processor (all shapes incl. random S&H) with a free-running phase.
 */

const TWO = 2;

interface ParamDesc {
  name: string;
  defaultValue: number;
  minValue: number;
  maxValue: number;
  automationRate: 'a-rate' | 'k-rate';
}
interface NodeOptions {
  processorOptions?: Record<string, unknown>;
}

/** PolyBLEP residual for a unit discontinuity at phase 0 (saw convention: subtract for a -2 jump). */
function polyblep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

function sawAt(p: number, dt: number): number {
  return TWO * p - 1 - polyblep(p, dt);
}

function pulseAt(p: number, dt: number, pw: number): number {
  let v = p < pw ? 1 : -1;
  v += polyblep(p, dt);
  let q = p - pw;
  if (q < 0) q += 1;
  v -= polyblep(q, dt);
  return v;
}

function triAt(p: number): number {
  return 4 * Math.abs(p - 0.5) - 1;
}

/** Blend saw -> tri -> pulse by shape in 0..1. */
function shapeValue(p: number, dt: number, shape: number, pw: number): number {
  if (shape <= 0.5) {
    const m = shape * 2;
    return sawAt(p, dt) * (1 - m) + triAt(p) * m;
  }
  const m = (shape - 0.5) * 2;
  return triAt(p) * (1 - m) + pulseAt(p, dt, pw) * m;
}

class Drift {
  private value = 0;
  private target = 0;
  private counter = 0;
  private readonly rand: () => number;
  constructor(seed: number) {
    let s = seed >>> 0 || 1;
    this.rand = () => {
      // xorshift32
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) / 4294967296) * 2 - 1;
    };
    this.target = this.rand();
  }
  /** Returns -1..1, slowly wandering. */
  next(sampleRate: number): number {
    if (--this.counter <= 0) {
      this.counter = Math.floor(sampleRate * (0.3 + Math.abs(this.rand()) * 1.2));
      this.target = this.rand();
    }
    this.value += (this.target - this.value) * (4 / sampleRate);
    return this.value;
  }
}

class VoiceProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): ParamDesc[] {
    return [
      { name: 'osc1Freq', defaultValue: 220, minValue: 0, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'osc1Mod', defaultValue: 0, minValue: -12000, maxValue: 12000, automationRate: 'a-rate' },
      { name: 'osc1Shape', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      { name: 'osc1Pw', defaultValue: 0.5, minValue: 0.02, maxValue: 0.98, automationRate: 'a-rate' },
      { name: 'osc2Freq', defaultValue: 220, minValue: 0, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'osc2Mod', defaultValue: 0, minValue: -12000, maxValue: 12000, automationRate: 'a-rate' },
      { name: 'osc2Shape', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      { name: 'osc2Pw', defaultValue: 0.5, minValue: 0.02, maxValue: 0.98, automationRate: 'a-rate' },
      { name: 'sync', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mixOsc1', defaultValue: 0.8, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mixOsc2', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mixSub', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mixNoise', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'slop', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  private p1 = 0;
  private p2 = 0;
  private pSub = 0;
  private last1 = 0;
  private readonly drift1: Drift;
  private readonly drift2: Drift;
  private readonly staticOffset1: number;
  private readonly staticOffset2: number;

  constructor(options?: NodeOptions) {
    super();
    const seed = (options?.processorOptions?.seed as number | undefined) ?? Math.floor(Math.random() * 1e9);
    this.drift1 = new Drift(seed * 7 + 1);
    this.drift2 = new Drift(seed * 13 + 5);
    this.staticOffset1 = ((seed % 97) / 97 - 0.5) * 2;
    this.staticOffset2 = (((seed * 31) % 89) / 89 - 0.5) * 2;
    // Randomise start phase so stacked voices don't phase-cancel.
    this.p1 = (seed % 1000) / 1000;
    this.p2 = ((seed * 7) % 1000) / 1000;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>): boolean {
    const out = outputs[0][0];
    const out2 = outputs[1]?.[0];
    if (!out) return true;
    const n = out.length;
    const sr = sampleRate;

    const f1 = params.osc1Freq;
    const m1 = params.osc1Mod;
    const s1 = params.osc1Shape;
    const w1 = params.osc1Pw;
    const f2 = params.osc2Freq;
    const m2 = params.osc2Mod;
    const s2 = params.osc2Shape;
    const w2 = params.osc2Pw;
    const sync = params.sync[0] > 0.5;
    const g1 = params.mixOsc1[0];
    const g2 = params.mixOsc2[0];
    const gs = params.mixSub[0];
    const gn = params.mixNoise[0];
    const slop = params.slop[0];

    const slopCents = slop * slop * 40; // up to ±40 cents of wander at full slop

    for (let i = 0; i < n; i++) {
      const d1 = this.drift1.next(sr);
      const d2 = this.drift2.next(sr);
      const cents1 = (m1.length > 1 ? m1[i] : m1[0]) + (d1 * 0.8 + this.staticOffset1 * 0.2) * slopCents;
      const cents2 = (m2.length > 1 ? m2[i] : m2[0]) + (d2 * 0.8 + this.staticOffset2 * 0.2) * slopCents;
      const hz1 = (f1.length > 1 ? f1[i] : f1[0]) * Math.pow(2, cents1 / 1200);
      const hz2 = (f2.length > 1 ? f2[i] : f2[0]) * Math.pow(2, cents2 / 1200);
      const dt1 = Math.min(hz1 / sr, 0.49);
      const dt2 = Math.min(hz2 / sr, 0.49);
      const shape1 = s1.length > 1 ? s1[i] : s1[0];
      const shape2 = s2.length > 1 ? s2[i] : s2[0];
      const pw1 = w1.length > 1 ? w1[i] : w1[0];
      const pw2 = w2.length > 1 ? w2[i] : w2[0];

      // ---- Osc2 (master for sync) ----
      this.p2 += dt2;
      let wrapped2 = false;
      let wrapFrac = 0;
      if (this.p2 >= 1) {
        this.p2 -= 1;
        wrapped2 = true;
        wrapFrac = dt2 > 0 ? this.p2 / dt2 : 0; // how far into this sample the wrap happened (0..1)
      }
      const v2 = shapeValue(this.p2, dt2, shape2, pw2);

      // ---- Osc1 ----
      this.p1 += dt1;
      let v1: number;
      if (this.p1 >= 1) {
        this.p1 -= 1;
        this.pSub += 0.5;
        if (this.pSub >= 1) this.pSub -= 1;
      }
      if (sync && wrapped2) {
        // Hard sync: restart Osc1 at the fractional time of the Osc2 wrap, BLEP the jump.
        const before = this.last1;
        this.p1 = wrapFrac * dt1;
        const naiveAfter = shapeValue(this.p1, dt1, shape1, pw1);
        const jump = naiveAfter - before;
        // One-sided polyBLEP correction for the sample right after the discontinuity.
        const t = Math.min(this.p1 / Math.max(dt1, 1e-9), 1);
        const resid = t + t - t * t - 1; // same as polyblep "after" branch
        v1 = naiveAfter + (jump / 2) * resid;
        this.pSub += 0.5;
        if (this.pSub >= 1) this.pSub -= 1;
      } else {
        v1 = shapeValue(this.p1, dt1, shape1, pw1);
      }
      this.last1 = v1;

      // ---- Sub (square one octave below Osc1) ----
      const sub = pulseAt(this.pSub, dt1 * 0.5, 0.5);

      // ---- Noise ----
      const noise = Math.random() * 2 - 1;

      out[i] = (v1 * g1 + v2 * g2 + sub * gs + noise * gn) * 0.5;
      if (out2) out2[i] = v2;
    }
    return true;
  }
}

/** LFO: tri / reverse saw / saw / square / random (S&H). Output -1..1 on a single channel. */
class LfoProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): ParamDesc[] {
    return [
      { name: 'rate', defaultValue: 2, minValue: 0.01, maxValue: 50, automationRate: 'k-rate' },
      { name: 'shape', defaultValue: 0, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
    ];
  }
  private phase = 0;
  private held = 0;
  process(_inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>): boolean {
    const out = outputs[0][0];
    if (!out) return true;
    const dt = params.rate[0] / sampleRate;
    const shape = Math.round(params.shape[0]);
    for (let i = 0; i < out.length; i++) {
      this.phase += dt;
      if (this.phase >= 1) {
        this.phase -= 1;
        this.held = Math.random() * 2 - 1;
      }
      const p = this.phase;
      let v: number;
      switch (shape) {
        case 0:
          v = p < 0.5 ? 4 * p - 1 : 3 - 4 * p; // tri, starts at -1 rising
          break;
        case 1:
          v = 1 - 2 * p; // reverse saw
          break;
        case 2:
          v = 2 * p - 1; // saw
          break;
        case 3:
          v = p < 0.5 ? 1 : -1; // square
          break;
        default:
          v = this.held;
      }
      out[i] = v;
    }
    return true;
  }
}

registerProcessor('fk6-voice', VoiceProcessor);
registerProcessor('fk6-lfo', LfoProcessor);
