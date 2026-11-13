import type { FxType, PatchParams } from '../params';
import { createEffect, distortionCurve, type EffectUnit } from './units';

const SMOOTH = 0.02;

class Slot {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private unit: EffectUnit | null = null;
  private type: FxType = 'off';
  private p1 = 0.5;
  private p2 = 0.5;

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = new GainNode(ctx);
    this.output = new GainNode(ctx);
    this.dry = new GainNode(ctx, { gain: 1 });
    this.wet = new GainNode(ctx, { gain: 0 });
    this.input.connect(this.dry).connect(this.output);
    this.wet.connect(this.output);
  }

  setType(type: FxType) {
    if (type === this.type) return;
    this.type = type;
    this.unit?.dispose();
    this.unit = createEffect(this.ctx, type);
    if (this.unit) {
      this.input.connect(this.unit.input);
      this.unit.output.connect(this.wet);
      this.unit.setP1(this.p1);
      this.unit.setP2(this.p2);
    }
  }

  setMix(v: number) {
    const t = this.ctx.currentTime;
    const on = this.unit !== null;
    this.wet.gain.setTargetAtTime(on ? v : 0, t, SMOOTH);
    this.dry.gain.setTargetAtTime(on ? 1 - v * 0.6 : 1, t, SMOOTH);
  }

  setP1(v: number) {
    this.p1 = v;
    this.unit?.setP1(v);
  }

  setP2(v: number) {
    this.p2 = v;
    this.unit?.setP2(v);
  }
}

export class EffectsChain {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly shaper: WaveShaperNode;
  private readonly distWet: GainNode;
  private readonly distDry: GainNode;
  private readonly slot1: Slot;
  private readonly slot2: Slot;
  private readonly bypassGain: GainNode;
  private readonly fxGain: GainNode;
  private lastDist = -1;

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = new GainNode(ctx);
    this.output = new GainNode(ctx);
    this.shaper = new WaveShaperNode(ctx, { curve: distortionCurve(0), oversample: '2x' });
    this.distWet = new GainNode(ctx, { gain: 0 });
    this.distDry = new GainNode(ctx, { gain: 1 });
    this.slot1 = new Slot(ctx);
    this.slot2 = new Slot(ctx);
    this.bypassGain = new GainNode(ctx, { gain: 0 });
    this.fxGain = new GainNode(ctx, { gain: 1 });

    const distOut = new GainNode(ctx);
    this.fxGain.connect(this.shaper).connect(this.distWet).connect(distOut);
    this.fxGain.connect(this.distDry).connect(distOut);
    distOut.connect(this.slot1.input);
    this.slot1.output.connect(this.slot2.input);
    this.slot2.output.connect(this.output);

    this.input.connect(this.fxGain);
    this.input.connect(this.bypassGain).connect(this.output);
  }

  apply(p: PatchParams) {
    const t = this.ctx.currentTime;
    this.fxGain.gain.setTargetAtTime(p.fxOn ? 1 : 0, t, SMOOTH);
    this.bypassGain.gain.setTargetAtTime(p.fxOn ? 0 : 1, t, SMOOTH);
    if (p.distortion !== this.lastDist) {
      this.lastDist = p.distortion;
      this.shaper.curve = distortionCurve(p.distortion);
      const wet = Math.min(1, p.distortion * 3);
      this.distWet.gain.setTargetAtTime(wet * (1 - p.distortion * 0.4), t, SMOOTH);
      this.distDry.gain.setTargetAtTime(1 - wet, t, SMOOTH);
    }
    this.slot1.setType(p.fx1Type);
    this.slot1.setP1(p.fx1P1);
    this.slot1.setP2(p.fx1P2);
    this.slot1.setMix(p.fx1Mix);
    this.slot2.setType(p.fx2Type);
    this.slot2.setP1(p.fx2P1);
    this.slot2.setP2(p.fx2P2);
    this.slot2.setMix(p.fx2Mix);
  }
}
