import type { FxType } from '../params';

/** A single effect unit. p1/p2 are 0..1 and mean something different per type. */
export interface EffectUnit {
  readonly input: AudioNode;
  readonly output: AudioNode;
  setP1(v: number): void;
  setP2(v: number): void;
  dispose(): void;
}

const SMOOTH = 0.02;
const expMap = (v: number, lo: number, hi: number) => lo * Math.pow(hi / lo, v);

function stereo(ctx: BaseAudioContext, left: AudioNode, right: AudioNode): ChannelMergerNode {
  const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  left.connect(merger, 0, 0);
  right.connect(merger, 0, 1);
  return merger;
}

// ---------------------------------------------------------------- delays

function makeDelay(ctx: BaseAudioContext, bbd: boolean): EffectUnit {
  const input = new GainNode(ctx);
  const delayL = new DelayNode(ctx, { maxDelayTime: 2 });
  const delayR = new DelayNode(ctx, { maxDelayTime: 2 });
  const fb = new GainNode(ctx, { gain: 0.4 });
  const tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: bbd ? 2800 : 12000, Q: 0.5 });
  const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 90, Q: 0.5 });
  input.connect(hp).connect(delayL);
  delayL.connect(tone).connect(fb).connect(delayL);
  // Right channel taps a slightly longer time for width (ping-pong-ish feel)
  fb.connect(delayR);
  input.connect(delayR);
  const output = stereo(ctx, delayL, delayR);
  const maxTime = bbd ? 0.7 : 1.4;
  const setTime = (v: number) => {
    const t = expMap(v, 0.02, maxTime);
    delayL.delayTime.setTargetAtTime(t, ctx.currentTime, 0.05);
    delayR.delayTime.setTargetAtTime(Math.min(1.9, t * 1.5), ctx.currentTime, 0.05);
  };
  setTime(0.5);
  return {
    input,
    output,
    setP1: setTime,
    setP2: (v) => fb.gain.setTargetAtTime(v * 0.9, ctx.currentTime, SMOOTH),
    dispose: () => {
      input.disconnect();
      delayL.disconnect();
      delayR.disconnect();
      fb.disconnect();
      tone.disconnect();
      hp.disconnect();
      output.disconnect();
    },
  };
}

// ---------------------------------------------------------------- chorus

function makeChorus(ctx: BaseAudioContext): EffectUnit {
  const input = new GainNode(ctx);
  const dL = new DelayNode(ctx, { maxDelayTime: 0.05, delayTime: 0.008 });
  const dR = new DelayNode(ctx, { maxDelayTime: 0.05, delayTime: 0.013 });
  const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 0.6 });
  const lfoInv = new GainNode(ctx, { gain: -1 });
  const depthL = new GainNode(ctx, { gain: 0.002 });
  const depthR = new GainNode(ctx, { gain: 0.002 });
  lfo.connect(depthL).connect(dL.delayTime);
  lfo.connect(lfoInv).connect(depthR).connect(dR.delayTime);
  lfo.start();
  input.connect(dL);
  input.connect(dR);
  const output = stereo(ctx, dL, dR);
  return {
    input,
    output,
    setP1: (v) => lfo.frequency.setTargetAtTime(expMap(v, 0.1, 6), ctx.currentTime, SMOOTH),
    setP2: (v) => {
      const d = 0.0003 + v * 0.0045;
      depthL.gain.setTargetAtTime(d, ctx.currentTime, SMOOTH);
      depthR.gain.setTargetAtTime(d, ctx.currentTime, SMOOTH);
    },
    dispose: () => {
      lfo.stop();
      for (const n of [input, dL, dR, lfo, lfoInv, depthL, depthR, output]) n.disconnect();
    },
  };
}

// ---------------------------------------------------------------- phaser

function makePhaser(ctx: BaseAudioContext): EffectUnit {
  const input = new GainNode(ctx);
  const stages: BiquadFilterNode[] = [];
  const base = [300, 500, 800, 1300, 2000, 3200];
  let prev: AudioNode = input;
  for (const f of base) {
    const ap = new BiquadFilterNode(ctx, { type: 'allpass', frequency: f, Q: 0.7 });
    prev.connect(ap);
    prev = ap;
    stages.push(ap);
  }
  const fb = new GainNode(ctx, { gain: 0.35 });
  prev.connect(fb).connect(stages[0]);
  const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 0.4 });
  const depth = new GainNode(ctx, { gain: 1800 }); // cents
  lfo.connect(depth);
  for (const s of stages) depth.connect(s.detune);
  lfo.start();
  const output = new GainNode(ctx);
  prev.connect(output);
  return {
    input,
    output,
    setP1: (v) => lfo.frequency.setTargetAtTime(expMap(v, 0.05, 8), ctx.currentTime, SMOOTH),
    setP2: (v) => depth.gain.setTargetAtTime(200 + v * 3000, ctx.currentTime, SMOOTH),
    dispose: () => {
      lfo.stop();
      for (const n of [input, ...stages, fb, lfo, depth, output]) n.disconnect();
    },
  };
}

// ---------------------------------------------------------------- ring mod

function makeRingMod(ctx: BaseAudioContext): EffectUnit {
  const input = new GainNode(ctx);
  const ring = new GainNode(ctx, { gain: 0 });
  const carrier = new OscillatorNode(ctx, { type: 'sine', frequency: 200 });
  const sweep = new OscillatorNode(ctx, { type: 'sine', frequency: 0.3 });
  const sweepDepth = new GainNode(ctx, { gain: 0 });
  carrier.connect(ring.gain);
  sweep.connect(sweepDepth).connect(carrier.detune);
  carrier.start();
  sweep.start();
  input.connect(ring);
  return {
    input,
    output: ring,
    setP1: (v) => carrier.frequency.setTargetAtTime(expMap(v, 20, 3000), ctx.currentTime, SMOOTH),
    setP2: (v) => sweepDepth.gain.setTargetAtTime(v * 2400, ctx.currentTime, SMOOTH),
    dispose: () => {
      carrier.stop();
      sweep.stop();
      for (const n of [input, ring, carrier, sweep, sweepDepth]) n.disconnect();
    },
  };
}

// ---------------------------------------------------------------- reverbs

type ReverbKind = 'hall' | 'room' | 'plate' | 'spring';

function buildImpulse(ctx: BaseAudioContext, kind: ReverbKind, size: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const base = { hall: 3.0, room: 0.9, plate: 1.8, spring: 1.4 }[kind];
  const seconds = base * (0.35 + size * 1.3);
  const len = Math.max(1, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const x = t / seconds;
      let env = Math.pow(1 - x, kind === 'plate' ? 2.2 : 3.2);
      let n = Math.random() * 2 - 1;
      if (kind === 'hall') {
        // slow build-up of density
        env *= Math.min(1, t / 0.08);
      } else if (kind === 'room') {
        // a few discrete early reflections then a short tail
        if (t < 0.06 && (i % Math.floor(sr * 0.011 + ch * 97)) === 0) n *= 6;
      } else if (kind === 'spring') {
        // characteristic "boing": chirpy ripple
        env *= 1 + 0.9 * Math.sin(2 * Math.PI * (28 + ch * 3) * t + 40 * Math.sin(t * 2.5));
      }
      // mild tonal smoothing so the tail isn't pure white
      lp += (n - lp) * (kind === 'plate' ? 0.9 : 0.6);
      d[i] = lp * env;
    }
  }
  return buf;
}

function makeReverb(ctx: BaseAudioContext, kind: ReverbKind): EffectUnit {
  const input = new GainNode(ctx);
  const damp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 8000, Q: 0.5 });
  const pre = new DelayNode(ctx, { maxDelayTime: 0.2, delayTime: kind === 'hall' ? 0.02 : 0.005 });
  const conv = new ConvolverNode(ctx, { disableNormalization: false });
  const output = new GainNode(ctx, { gain: kind === 'spring' ? 0.8 : 1 });
  input.connect(damp).connect(pre).connect(conv).connect(output);
  let size = 0.5;
  let timer: number | undefined;
  const rebuild = () => {
    conv.buffer = buildImpulse(ctx, kind, size);
  };
  rebuild();
  return {
    input,
    output,
    setP1: (v) => {
      size = v;
      clearTimeout(timer);
      timer = window.setTimeout(rebuild, 120);
    },
    setP2: (v) => damp.frequency.setTargetAtTime(expMap(1 - v, 1200, 16000), ctx.currentTime, SMOOTH),
    dispose: () => {
      clearTimeout(timer);
      for (const n of [input, damp, pre, conv, output]) n.disconnect();
    },
  };
}

// ---------------------------------------------------------------- factory

export function createEffect(ctx: BaseAudioContext, type: FxType): EffectUnit | null {
  switch (type) {
    case 'bbd':
      return makeDelay(ctx, true);
    case 'ddl':
      return makeDelay(ctx, false);
    case 'chorus':
      return makeChorus(ctx);
    case 'phaser':
      return makePhaser(ctx);
    case 'ringmod':
      return makeRingMod(ctx);
    case 'hall':
    case 'room':
    case 'plate':
    case 'spring':
      return makeReverb(ctx, type);
    default:
      return null;
  }
}

/** Soft-clip curve for the distortion WaveShaper. amount 0 = identity. */
export function distortionCurve(amount: number, n = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = amount * amount * 60;
  const norm = (1 + k) / (1 + k); // keep |y(1)| = 1
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = (((1 + k) * x) / (1 + k * Math.abs(x))) * norm;
  }
  return curve;
}
