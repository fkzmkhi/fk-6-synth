import { Envelope } from './envelope';
import { midiToFreq } from './note';
import { cutoffHz, glideSeconds, hpfHz, resonanceQ, type PatchParams } from './params';

export type VoiceState = 'free' | 'held' | 'released';

/** Modulation depth scalers (in cents unless noted). */
const LFO_OSC_CENTS = 700;
const LFO_PW = 0.45;
const LFO_FILTER_CENTS = 4800;
const ENV_FILTER_CENTS = 7200;
const PM_OSC_CENTS = 2400;
const PM_SHAPE = 0.6;
const PM_FILTER_CENTS = 4800;
const SMOOTH = 0.008;

export interface GlobalMod {
  /** LFO already scaled by (initial amount + mod wheel): -1..1 */
  lfo: AudioNode;
  /** Pitch bend + master tune, in cents */
  bend: AudioNode;
}

export class Voice {
  readonly osc: AudioWorkletNode;
  readonly hpf: BiquadFilterNode;
  readonly lpf1: BiquadFilterNode;
  readonly lpf2: BiquadFilterNode;
  readonly vca: GainNode;
  readonly trem: GainNode;
  readonly fEnv: Envelope;
  readonly aEnv: Envelope;
  readonly pitchOffset: ConstantSourceNode;

  // modulation routing gains
  private readonly fEnvToLpf: GainNode;
  private readonly fEnvToHpf: GainNode;
  private readonly fEnvToOsc1: GainNode;
  private readonly fEnvToShape: GainNode;
  private readonly o2ToOsc1: GainNode;
  private readonly o2ToShape: GainNode;
  private readonly o2ToLpf: GainNode;
  private readonly o2ToHpf: GainNode;
  private readonly lfoToOsc1: GainNode;
  private readonly lfoToOsc2: GainNode;
  private readonly lfoToPw: GainNode;
  private readonly lfoToLpf: GainNode;
  private readonly lfoToHpf: GainNode;
  private readonly lfoToAmp: GainNode;

  note = -1;
  state: VoiceState = 'free';
  startedAt = 0;
  releasedAt = 0;
  private lastMidi = -1;
  private velocity = 1;

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
    mod: GlobalMod,
    readonly index: number,
  ) {
    this.osc = new AudioWorkletNode(ctx, 'fk6-voice', {
      numberOfInputs: 0,
      numberOfOutputs: 2,
      outputChannelCount: [1, 1],
      processorOptions: { seed: 1337 + index * 7919 },
    });
    this.hpf = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 10, Q: 0.5 });
    this.lpf1 = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2000, Q: 0.6 });
    this.lpf2 = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2000, Q: 0.7 });
    this.vca = new GainNode(ctx, { gain: 0 });
    this.trem = new GainNode(ctx, { gain: 1 });
    this.fEnv = new Envelope(ctx);
    this.aEnv = new Envelope(ctx);
    this.pitchOffset = new ConstantSourceNode(ctx, { offset: 0 });
    this.pitchOffset.start();

    this.osc.connect(this.hpf, 0).connect(this.lpf1).connect(this.lpf2).connect(this.vca).connect(this.trem).connect(destination);
    this.aEnv.output.connect(this.vca.gain);

    const g = (v = 0) => new GainNode(ctx, { gain: v });
    const p = (name: string) => this.osc.parameters.get(name)!;

    // Filter envelope
    this.fEnvToLpf = g();
    this.fEnvToHpf = g();
    this.fEnvToOsc1 = g();
    this.fEnvToShape = g();
    this.fEnv.output.connect(this.fEnvToLpf);
    this.fEnv.output.connect(this.fEnvToHpf);
    this.fEnv.output.connect(this.fEnvToOsc1);
    this.fEnv.output.connect(this.fEnvToShape);
    this.fEnvToLpf.connect(this.lpf1.detune);
    this.fEnvToLpf.connect(this.lpf2.detune);
    this.fEnvToHpf.connect(this.hpf.detune);
    this.fEnvToOsc1.connect(p('osc1Mod'));
    this.fEnvToShape.connect(p('osc1Shape'));

    // Osc2 poly-mod (worklet output 1 = raw osc2)
    this.o2ToOsc1 = g();
    this.o2ToShape = g();
    this.o2ToLpf = g();
    this.o2ToHpf = g();
    this.osc.connect(this.o2ToOsc1, 1);
    this.osc.connect(this.o2ToShape, 1);
    this.osc.connect(this.o2ToLpf, 1);
    this.osc.connect(this.o2ToHpf, 1);
    this.o2ToOsc1.connect(p('osc1Mod'));
    this.o2ToShape.connect(p('osc1Shape'));
    this.o2ToLpf.connect(this.lpf1.detune);
    this.o2ToLpf.connect(this.lpf2.detune);
    this.o2ToHpf.connect(this.hpf.detune);

    // LFO
    this.lfoToOsc1 = g();
    this.lfoToOsc2 = g();
    this.lfoToPw = g();
    this.lfoToLpf = g();
    this.lfoToHpf = g();
    this.lfoToAmp = g();
    for (const n of [this.lfoToOsc1, this.lfoToOsc2, this.lfoToPw, this.lfoToLpf, this.lfoToHpf, this.lfoToAmp]) mod.lfo.connect(n);
    this.lfoToOsc1.connect(p('osc1Mod'));
    this.lfoToOsc2.connect(p('osc2Mod'));
    this.lfoToPw.connect(p('osc1Pw'));
    this.lfoToPw.connect(p('osc2Pw'));
    this.lfoToLpf.connect(this.lpf1.detune);
    this.lfoToLpf.connect(this.lpf2.detune);
    this.lfoToHpf.connect(this.hpf.detune);
    this.lfoToAmp.connect(this.trem.gain);

    // Pitch bend / tune / unison offset
    mod.bend.connect(p('osc1Mod'));
    mod.bend.connect(p('osc2Mod'));
    this.pitchOffset.connect(p('osc1Mod'));
    this.pitchOffset.connect(p('osc2Mod'));
  }

  private param(name: string) {
    return this.osc.parameters.get(name)!;
  }

  // ---------- parameter application ----------

  applyOsc(p: PatchParams, t = this.ctx.currentTime) {
    this.param('osc1Shape').setTargetAtTime(p.osc1Shape, t, SMOOTH);
    this.param('osc1Pw').setTargetAtTime(p.osc1Pw, t, SMOOTH);
    this.param('osc2Shape').setTargetAtTime(p.osc2Shape, t, SMOOTH);
    this.param('osc2Pw').setTargetAtTime(p.osc2Pw, t, SMOOTH);
    this.param('sync').setValueAtTime(p.osc1Sync ? 1 : 0, t);
    this.param('mixOsc1').setTargetAtTime(p.mixOsc1, t, SMOOTH);
    this.param('mixOsc2').setTargetAtTime(p.mixOsc2, t, SMOOTH);
    this.param('mixSub').setTargetAtTime(p.mixSub, t, SMOOTH);
    this.param('mixNoise').setTargetAtTime(p.mixNoise, t, SMOOTH);
    this.param('slop').setValueAtTime(p.slop, t);
    if (this.state !== 'free') this.setPitch(p, this.note, t, false);
  }

  applyFilter(p: PatchParams, t = this.ctx.currentTime) {
    const hq = resonanceQ(p.hpfRes) * 0.5;
    this.hpf.frequency.setTargetAtTime(hpfHz(p.hpfCutoff), t, SMOOTH);
    this.hpf.Q.setTargetAtTime(hq, t, SMOOTH);
    this.lpf2.Q.setTargetAtTime(resonanceQ(p.lpfRes), t, SMOOTH);
    this.fEnvToLpf.gain.setTargetAtTime((p.lpfEnvAmt + (p.pmLpf ? p.pmFEnvAmt : 0)) * ENV_FILTER_CENTS, t, SMOOTH);
    this.fEnvToHpf.gain.setTargetAtTime((p.hpfEnvAmt + (p.pmHpf ? p.pmFEnvAmt : 0)) * ENV_FILTER_CENTS, t, SMOOTH);
    if (this.state !== 'free') this.setCutoff(p, this.note, t);
  }

  applyEnvelopes(p: PatchParams) {
    this.fEnv.adsr = { attack: p.fAttack, decay: p.fDecay, sustain: p.fSustain, release: p.fRelease };
    this.aEnv.adsr = { attack: p.aAttack, decay: p.aDecay, sustain: p.aSustain, release: p.aRelease };
  }

  applyMod(p: PatchParams, t = this.ctx.currentTime) {
    // Poly mod
    this.fEnvToOsc1.gain.setTargetAtTime(p.pmOsc1Freq ? p.pmFEnvAmt * PM_OSC_CENTS : 0, t, SMOOTH);
    this.fEnvToShape.gain.setTargetAtTime(p.pmOsc1Shape ? p.pmFEnvAmt * PM_SHAPE : 0, t, SMOOTH);
    this.o2ToOsc1.gain.setTargetAtTime(p.pmOsc1Freq ? p.pmOsc2Amt * PM_OSC_CENTS : 0, t, SMOOTH);
    this.o2ToShape.gain.setTargetAtTime(p.pmOsc1Shape ? p.pmOsc2Amt * PM_SHAPE : 0, t, SMOOTH);
    this.o2ToLpf.gain.setTargetAtTime(p.pmLpf ? p.pmOsc2Amt * PM_FILTER_CENTS : 0, t, SMOOTH);
    this.o2ToHpf.gain.setTargetAtTime(p.pmHpf ? p.pmOsc2Amt * PM_FILTER_CENTS : 0, t, SMOOTH);
    // LFO
    this.lfoToOsc1.gain.setTargetAtTime(p.lfoOsc1 ? LFO_OSC_CENTS : 0, t, SMOOTH);
    this.lfoToOsc2.gain.setTargetAtTime(p.lfoOsc2 ? LFO_OSC_CENTS : 0, t, SMOOTH);
    this.lfoToPw.gain.setTargetAtTime(p.lfoPw ? LFO_PW : 0, t, SMOOTH);
    this.lfoToLpf.gain.setTargetAtTime(p.lfoLpf ? LFO_FILTER_CENTS : 0, t, SMOOTH);
    this.lfoToHpf.gain.setTargetAtTime(p.lfoHpf ? LFO_FILTER_CENTS : 0, t, SMOOTH);
    this.lfoToAmp.gain.setTargetAtTime(p.lfoAmp ? 0.5 : 0, t, SMOOTH);
    // Filter env routed to LPF/HPF via poly-mod is folded into applyFilter
    this.applyFilter(p, t);
  }

  applyAll(p: PatchParams) {
    this.applyOsc(p);
    this.applyEnvelopes(p);
    this.applyMod(p);
  }

  setUnisonOffset(cents: number, t = this.ctx.currentTime) {
    this.pitchOffset.offset.setTargetAtTime(cents, t, SMOOTH);
  }

  // ---------- pitch / cutoff ----------

  private osc1Hz(p: PatchParams, midi: number) {
    return midiToFreq(midi + p.osc1Freq - 24);
  }

  private osc2Hz(p: PatchParams, midi: number) {
    if (p.osc2LowFreq) {
      // 0.05 Hz .. ~13 Hz, fine adds ±1 "step"
      return 0.05 * Math.pow(2, (p.osc2Freq + p.osc2Fine) / 6);
    }
    const base = p.osc2KeyTrack ? midi : 60;
    return midiToFreq(base + p.osc2Freq - 24 + p.osc2Fine * 0.5);
  }

  private setPitch(p: PatchParams, midi: number, t: number, glide: boolean) {
    const f1 = this.param('osc1Freq');
    const f2 = this.param('osc2Freq');
    const hz1 = this.osc1Hz(p, midi);
    const hz2 = this.osc2Hz(p, midi);
    f1.cancelScheduledValues(t);
    f2.cancelScheduledValues(t);
    if (glide && this.lastMidi >= 0 && this.lastMidi !== midi) {
      const tc = glideSeconds(p.glideRate) / 3;
      f1.setValueAtTime(this.osc1Hz(p, this.lastMidi), t);
      f1.setTargetAtTime(hz1, t, tc);
      f2.setValueAtTime(this.osc2Hz(p, this.lastMidi), t);
      f2.setTargetAtTime(hz2, t, tc);
    } else {
      f1.setTargetAtTime(hz1, t, 0.002);
      f2.setTargetAtTime(hz2, t, 0.002);
    }
  }

  private setCutoff(p: PatchParams, midi: number, t: number) {
    const kt = p.lpfKeyTrack === 'full' ? 1 : p.lpfKeyTrack === 'half' ? 0.5 : 0;
    const hz = Math.min(20000, cutoffHz(p.lpfCutoff) * Math.pow(2, ((midi - 60) / 12) * kt));
    this.lpf1.frequency.setTargetAtTime(hz, t, SMOOTH);
    this.lpf2.frequency.setTargetAtTime(hz, t, SMOOTH);
  }

  // ---------- note events ----------

  noteOn(midi: number, velocity: number, t: number, p: PatchParams) {
    const retrigger = this.state !== 'free';
    this.setPitch(p, midi, t, p.glideOn);
    this.setCutoff(p, midi, t);
    this.lastMidi = midi;
    this.note = midi;
    this.velocity = velocity;
    this.state = 'held';
    this.startedAt = t;
    const aPeak = p.aVelocity ? 0.25 + 0.75 * velocity : 1;
    const fPeak = p.lpfVelocity ? 0.2 + 0.8 * velocity : 1;
    if (retrigger) {
      // tiny dip to avoid a hard click when stealing
      this.aEnv.kill(t);
      this.fEnv.kill(t);
      t += 0.004;
    }
    this.aEnv.trigger(t, aPeak);
    this.fEnv.trigger(t, fPeak);
  }

  noteOff(t: number) {
    if (this.state !== 'held') return;
    this.state = 'released';
    this.releasedAt = t;
    this.aEnv.release(t);
    this.fEnv.release(t);
  }

  /** True once the release tail has passed. */
  isSilentAt(t: number) {
    return this.state === 'released' && t > this.releasedAt + this.aEnv.releaseTail;
  }

  get currentVelocity() {
    return this.velocity;
  }
}
