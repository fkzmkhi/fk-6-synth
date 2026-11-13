import workletUrl from './worklet/voice-processor.ts?worker&url';
import { EffectsChain } from './effects/chain';
import { DEFAULT_PATCH, lfoHz, type LfoShape, type ParamKey, type PatchParams } from './params';
import { clamp } from './note';
import { Voice } from './voice';

const VOICES = 6;
const LFO_SHAPES: LfoShape[] = ['tri', 'revsaw', 'saw', 'square', 'random'];
const BEND_RANGE_CENTS = 200;

const OSC_KEYS = new Set<ParamKey>([
  'osc1Freq', 'osc1Shape', 'osc1Pw', 'osc1Sync', 'osc2Freq', 'osc2Fine', 'osc2Shape', 'osc2Pw', 'osc2LowFreq', 'osc2KeyTrack',
  'mixOsc1', 'mixOsc2', 'mixSub', 'mixNoise', 'slop', 'glideOn', 'glideRate',
]);
const FILTER_KEYS = new Set<ParamKey>(['lpfCutoff', 'lpfRes', 'lpfEnvAmt', 'lpfVelocity', 'lpfKeyTrack', 'hpfCutoff', 'hpfRes', 'hpfEnvAmt']);
const ENV_KEYS = new Set<ParamKey>(['fAttack', 'fDecay', 'fSustain', 'fRelease', 'aAttack', 'aDecay', 'aSustain', 'aRelease', 'aVelocity']);
const MOD_KEYS = new Set<ParamKey>([
  'lfoOsc1', 'lfoOsc2', 'lfoPw', 'lfoLpf', 'lfoHpf', 'lfoAmp', 'pmFEnvAmt', 'pmOsc2Amt', 'pmOsc1Freq', 'pmOsc1Shape', 'pmLpf', 'pmHpf',
]);
const FX_KEYS = new Set<ParamKey>(['fxOn', 'distortion', 'fx1Type', 'fx1Mix', 'fx1P1', 'fx1P2', 'fx2Type', 'fx2Mix', 'fx2P1', 'fx2P2']);

export type ParamListener = <K extends ParamKey>(key: K, value: PatchParams[K]) => void;

export class SynthEngine {
  readonly params: PatchParams = { ...DEFAULT_PATCH };
  readonly voices: Voice[] = [];
  readonly fx: EffectsChain;
  readonly master: GainNode;
  readonly analyser: AnalyserNode;
  private readonly voiceBus: GainNode;
  private readonly lfo: AudioWorkletNode;
  private readonly lfoAmt: GainNode;
  private readonly bend: ConstantSourceNode;
  private modWheel = 0;
  private pitchBend = 0;
  private masterTune = 0;
  private holdOn = false;
  private readonly heldKeys = new Set<number>();
  private readonly listeners = new Set<ParamListener>();
  private readonly wheelListeners = new Set<(bend: number, mod: number) => void>();
  private lastNote = -1;

  private constructor(readonly ctx: AudioContext) {
    this.master = new GainNode(ctx, { gain: 0.7 });
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -3, knee: 2, ratio: 12, attack: 0.002, release: 0.1 });
    this.analyser = new AnalyserNode(ctx, { fftSize: 1024 });
    this.voiceBus = new GainNode(ctx, { gain: 0.5 });
    this.fx = new EffectsChain(ctx);
    this.voiceBus.connect(this.fx.input);
    this.fx.output.connect(this.master).connect(limiter).connect(this.analyser).connect(ctx.destination);

    this.lfo = new AudioWorkletNode(ctx, 'fk6-lfo', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    this.lfoAmt = new GainNode(ctx, { gain: 0 });
    this.lfo.connect(this.lfoAmt);
    this.bend = new ConstantSourceNode(ctx, { offset: 0 });
    this.bend.start();

    for (let i = 0; i < VOICES; i++) {
      this.voices.push(new Voice(ctx, this.voiceBus, { lfo: this.lfoAmt, bend: this.bend }, i));
    }
    this.applyAll();
  }

  static async create(): Promise<SynthEngine> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(workletUrl);
    return new SynthEngine(ctx);
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  get now() {
    return this.ctx.currentTime;
  }

  // ---------- parameters ----------

  onChange(fn: ParamListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setParam<K extends ParamKey>(key: K, value: PatchParams[K], notify = true) {
    if (this.params[key] === value) return;
    this.params[key] = value;
    this.dispatch(key);
    if (notify) for (const l of this.listeners) l(key, value);
  }

  loadPatch(patch: Partial<PatchParams>) {
    Object.assign(this.params, DEFAULT_PATCH, patch);
    this.applyAll();
    for (const key of Object.keys(this.params) as ParamKey[]) {
      for (const l of this.listeners) l(key, this.params[key]);
    }
  }

  private dispatch(key: ParamKey) {
    const p = this.params;
    if (OSC_KEYS.has(key)) for (const v of this.voices) v.applyOsc(p);
    else if (FILTER_KEYS.has(key)) for (const v of this.voices) v.applyFilter(p);
    else if (ENV_KEYS.has(key)) for (const v of this.voices) v.applyEnvelopes(p);
    else if (MOD_KEYS.has(key)) for (const v of this.voices) v.applyMod(p);
    else if (FX_KEYS.has(key)) this.fx.apply(p);
    else if (key === 'lfoFreq' || key === 'lfoShape' || key === 'lfoAmt') this.applyLfo();
    else if (key === 'unison' || key === 'unisonDetune') this.applyUnison();
  }

  private applyAll() {
    const p = this.params;
    for (const v of this.voices) v.applyAll(p);
    this.fx.apply(p);
    this.applyLfo();
    this.applyUnison();
  }

  private applyLfo() {
    const p = this.params;
    const t = this.now;
    this.lfo.parameters.get('rate')!.setTargetAtTime(lfoHz(p.lfoFreq), t, 0.01);
    this.lfo.parameters.get('shape')!.setValueAtTime(LFO_SHAPES.indexOf(p.lfoShape), t);
    this.lfoAmt.gain.setTargetAtTime(clamp(p.lfoAmt + this.modWheel, 0, 1), t, 0.01);
  }

  private applyUnison() {
    const p = this.params;
    for (const v of this.voices) {
      const spread = p.unison ? ((v.index - (VOICES - 1) / 2) / ((VOICES - 1) / 2)) * p.unisonDetune * 30 : 0;
      v.setUnisonOffset(spread);
    }
    if (!p.unison) return;
    // When switching to unison, consolidate onto the last note.
    if (this.lastNote >= 0 && this.voices.some((v) => v.state === 'held')) {
      const t = this.now;
      for (const v of this.voices) v.noteOn(this.lastNote, v.currentVelocity, t, p);
    }
  }

  // ---------- performance controls ----------

  /** Observe wheel changes from any source (UI, MIDI input). */
  onWheel(fn: (bend: number, mod: number) => void) {
    this.wheelListeners.add(fn);
    return () => this.wheelListeners.delete(fn);
  }

  setModWheel(v: number) {
    this.modWheel = clamp(v, 0, 1);
    this.applyLfo();
    for (const l of this.wheelListeners) l(this.pitchBend, this.modWheel);
  }

  setPitchBend(v: number) {
    this.pitchBend = clamp(v, -1, 1);
    this.updateBend();
    for (const l of this.wheelListeners) l(this.pitchBend, this.modWheel);
  }

  setMasterTune(cents: number) {
    this.masterTune = cents;
    this.updateBend();
  }

  private updateBend() {
    this.bend.offset.setTargetAtTime(this.pitchBend * BEND_RANGE_CENTS + this.masterTune, this.now, 0.005);
  }

  setMasterVolume(v: number) {
    this.master.gain.setTargetAtTime(clamp(v, 0, 1), this.now, 0.01);
  }

  setHold(on: boolean) {
    this.holdOn = on;
    if (!on) {
      const t = this.now;
      for (const v of this.voices) if (v.state === 'held' && !this.heldKeys.has(v.note)) v.noteOff(t);
    }
  }

  get hold() {
    return this.holdOn;
  }

  // ---------- note events (keyboard: hold-aware) ----------

  noteOn(midi: number, velocity = 1, t = this.now) {
    this.heldKeys.add(midi);
    this.triggerNote(midi, velocity, t);
  }

  noteOff(midi: number, t = this.now) {
    this.heldKeys.delete(midi);
    if (this.holdOn) return;
    this.releaseNote(midi, t);
    // Unison legato: fall back to the most recent still-held key
    if (this.params.unison && this.heldKeys.size > 0) {
      const last = [...this.heldKeys].pop()!;
      this.triggerNote(last, 1, t);
    }
  }

  // ---------- raw voice control (arp / sequencer) ----------

  triggerNote(midi: number, velocity: number, t: number) {
    const p = this.params;
    this.lastNote = midi;
    if (p.unison) {
      for (const v of this.voices) v.noteOn(midi, velocity, t, p);
      return;
    }
    // Same note already sounding -> retrigger that voice
    const same = this.voices.find((v) => v.state !== 'free' && v.note === midi);
    const voice = same ?? this.allocate(t);
    voice.noteOn(midi, velocity, t, p);
  }

  releaseNote(midi: number, t: number) {
    for (const v of this.voices) if (v.state === 'held' && v.note === midi) v.noteOff(t);
  }

  allNotesOff(t = this.now) {
    this.heldKeys.clear();
    for (const v of this.voices) v.noteOff(t);
  }

  private allocate(t: number): Voice {
    const free = this.voices.find((v) => v.state === 'free' || v.isSilentAt(t));
    if (free) return free;
    const released = this.voices.filter((v) => v.state === 'released').sort((a, b) => a.releasedAt - b.releasedAt)[0];
    if (released) return released;
    return [...this.voices].sort((a, b) => a.startedAt - b.startedAt)[0];
  }

  /** Notes currently held on the keyboard (for the arpeggiator). */
  get heldNotes(): number[] {
    return [...this.heldKeys];
  }
}
