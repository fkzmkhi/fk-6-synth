/**
 * Patch parameter schema. Every knob / button on the panel maps to one key here.
 * Values are stored in "musical" units (Hz, semitones, 0..1) — not normalised.
 */

export type LfoShape = 'tri' | 'revsaw' | 'saw' | 'square' | 'random';
export type KeyTrack = 'off' | 'half' | 'full';
export type FxType = 'off' | 'bbd' | 'ddl' | 'chorus' | 'phaser' | 'ringmod' | 'hall' | 'room' | 'plate' | 'spring';
export type ArpMode = 'up' | 'down' | 'updown' | 'random' | 'assign';
export type TimeDiv = '1/4' | '1/8' | '1/8T' | '1/16' | '1/16T' | '1/32';

export interface PatchParams {
  // Oscillator 1
  osc1Freq: number; // semitones, 0..48 (C0 base)
  osc1Shape: number; // 0 saw -> 0.5 tri -> 1 pulse
  osc1Pw: number; // 0..1 pulse width (0.5 square)
  osc1Sync: boolean;
  // Oscillator 2
  osc2Freq: number; // semitones 0..48
  osc2Fine: number; // -1..1 (± 50 cents, or ± Hz-ish in low freq mode)
  osc2Shape: number;
  osc2Pw: number;
  osc2LowFreq: boolean;
  osc2KeyTrack: boolean;
  // Mixer
  mixOsc1: number;
  mixOsc2: number;
  mixSub: number;
  mixNoise: number;
  // Low-pass filter
  lpfCutoff: number; // 0..1 (mapped exponentially 20Hz..20kHz)
  lpfRes: number; // 0..1
  lpfEnvAmt: number; // -1..1
  lpfVelocity: boolean;
  lpfKeyTrack: KeyTrack;
  // High-pass filter
  hpfCutoff: number; // 0..1
  hpfRes: number;
  hpfEnvAmt: number; // -1..1
  // Filter envelope
  fAttack: number; // seconds
  fDecay: number;
  fSustain: number; // 0..1
  fRelease: number;
  // Amp envelope
  aAttack: number;
  aDecay: number;
  aSustain: number;
  aRelease: number;
  aVelocity: boolean;
  // LFO
  lfoFreq: number; // 0..1 -> 0.05..30Hz
  lfoAmt: number; // 0..1 initial amount
  lfoShape: LfoShape;
  lfoOsc1: boolean;
  lfoOsc2: boolean;
  lfoPw: boolean;
  lfoLpf: boolean;
  lfoHpf: boolean;
  lfoAmp: boolean;
  // Poly mod
  pmFEnvAmt: number; // -1..1
  pmOsc2Amt: number; // 0..1
  pmOsc1Freq: boolean;
  pmOsc1Shape: boolean;
  pmLpf: boolean;
  pmHpf: boolean;
  // Voice / misc
  unison: boolean;
  unisonDetune: number; // 0..1
  glideOn: boolean;
  glideRate: number; // 0..1
  slop: number; // 0..1 vintage drift
  // Effects
  fxOn: boolean;
  distortion: number; // 0..1
  fx1Type: FxType;
  fx1Mix: number;
  fx1P1: number;
  fx1P2: number;
  fx2Type: FxType;
  fx2Mix: number;
  fx2P1: number;
  fx2P2: number;
  // Arpeggiator / sequencer
  arpOn: boolean;
  arpMode: ArpMode;
  arpRange: 1 | 2 | 3;
  bpm: number;
  timeDiv: TimeDiv;
}

export const DEFAULT_PATCH: PatchParams = {
  osc1Freq: 24,
  osc1Shape: 0,
  osc1Pw: 0.5,
  osc1Sync: false,
  osc2Freq: 24,
  osc2Fine: 0,
  osc2Shape: 0,
  osc2Pw: 0.5,
  osc2LowFreq: false,
  osc2KeyTrack: true,
  mixOsc1: 0.8,
  mixOsc2: 0.0,
  mixSub: 0.0,
  mixNoise: 0.0,
  lpfCutoff: 0.6,
  lpfRes: 0.1,
  lpfEnvAmt: 0.4,
  lpfVelocity: false,
  lpfKeyTrack: 'half',
  hpfCutoff: 0.0,
  hpfRes: 0.0,
  hpfEnvAmt: 0.0,
  fAttack: 0.01,
  fDecay: 0.4,
  fSustain: 0.3,
  fRelease: 0.3,
  aAttack: 0.005,
  aDecay: 0.3,
  aSustain: 0.8,
  aRelease: 0.3,
  aVelocity: true,
  lfoFreq: 0.45,
  lfoAmt: 0,
  lfoShape: 'tri',
  lfoOsc1: false,
  lfoOsc2: false,
  lfoPw: false,
  lfoLpf: false,
  lfoHpf: false,
  lfoAmp: false,
  pmFEnvAmt: 0,
  pmOsc2Amt: 0,
  pmOsc1Freq: false,
  pmOsc1Shape: false,
  pmLpf: false,
  pmHpf: false,
  unison: false,
  unisonDetune: 0.3,
  glideOn: false,
  glideRate: 0.3,
  slop: 0.15,
  fxOn: true,
  distortion: 0,
  fx1Type: 'off',
  fx1Mix: 0.3,
  fx1P1: 0.5,
  fx1P2: 0.5,
  fx2Type: 'off',
  fx2Mix: 0.3,
  fx2P1: 0.5,
  fx2P2: 0.5,
  arpOn: false,
  arpMode: 'up',
  arpRange: 1,
  bpm: 120,
  timeDiv: '1/16',
};

export type ParamKey = keyof PatchParams;
export type NumericKey = { [K in ParamKey]: PatchParams[K] extends number ? K : never }[ParamKey];
export type BoolKey = { [K in ParamKey]: PatchParams[K] extends boolean ? K : never }[ParamKey];

/** Curve used when mapping a knob's 0..1 position to the stored value. */
export type Curve = 'lin' | 'exp';

export interface NumericMeta {
  min: number;
  max: number;
  step?: number;
  curve?: Curve;
  /** Human readable value for the display. */
  format?: (v: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)}`;
const sec = (v: number) => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`);
const semi = (v: number) => `${Math.round(v)}st`;
const bipolar = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}`;

export const NUMERIC_META: Record<NumericKey, NumericMeta> = {
  osc1Freq: { min: 0, max: 48, step: 1, format: semi },
  osc1Shape: { min: 0, max: 1, format: pct },
  osc1Pw: { min: 0.05, max: 0.95, format: pct },
  osc2Freq: { min: 0, max: 48, step: 1, format: semi },
  osc2Fine: { min: -1, max: 1, format: bipolar },
  osc2Shape: { min: 0, max: 1, format: pct },
  osc2Pw: { min: 0.05, max: 0.95, format: pct },
  mixOsc1: { min: 0, max: 1, format: pct },
  mixOsc2: { min: 0, max: 1, format: pct },
  mixSub: { min: 0, max: 1, format: pct },
  mixNoise: { min: 0, max: 1, format: pct },
  lpfCutoff: { min: 0, max: 1, format: (v) => `${Math.round(cutoffHz(v))}Hz` },
  lpfRes: { min: 0, max: 1, format: pct },
  lpfEnvAmt: { min: -1, max: 1, format: bipolar },
  hpfCutoff: { min: 0, max: 1, format: (v) => `${Math.round(hpfHz(v))}Hz` },
  hpfRes: { min: 0, max: 1, format: pct },
  hpfEnvAmt: { min: -1, max: 1, format: bipolar },
  fAttack: { min: 0.001, max: 10, curve: 'exp', format: sec },
  fDecay: { min: 0.005, max: 10, curve: 'exp', format: sec },
  fSustain: { min: 0, max: 1, format: pct },
  fRelease: { min: 0.005, max: 10, curve: 'exp', format: sec },
  aAttack: { min: 0.001, max: 10, curve: 'exp', format: sec },
  aDecay: { min: 0.005, max: 10, curve: 'exp', format: sec },
  aSustain: { min: 0, max: 1, format: pct },
  aRelease: { min: 0.005, max: 10, curve: 'exp', format: sec },
  lfoFreq: { min: 0, max: 1, format: (v) => `${lfoHz(v).toFixed(2)}Hz` },
  lfoAmt: { min: 0, max: 1, format: pct },
  pmFEnvAmt: { min: -1, max: 1, format: bipolar },
  pmOsc2Amt: { min: 0, max: 1, format: pct },
  unisonDetune: { min: 0, max: 1, format: pct },
  glideRate: { min: 0, max: 1, format: pct },
  slop: { min: 0, max: 1, format: pct },
  distortion: { min: 0, max: 1, format: pct },
  fx1Mix: { min: 0, max: 1, format: pct },
  fx1P1: { min: 0, max: 1, format: pct },
  fx1P2: { min: 0, max: 1, format: pct },
  fx2Mix: { min: 0, max: 1, format: pct },
  fx2P1: { min: 0, max: 1, format: pct },
  fx2P2: { min: 0, max: 1, format: pct },
  bpm: { min: 30, max: 250, step: 1, format: (v) => `${Math.round(v)}` },
  arpRange: { min: 1, max: 3, step: 1, format: (v) => `${Math.round(v)} oct` },
};

// ---- Mapping helpers shared by engine and display ----
export const cutoffHz = (v: number) => 20 * Math.pow(1000, v); // 20Hz .. 20kHz
export const hpfHz = (v: number) => 10 * Math.pow(800, v); // 10Hz .. 8kHz
export const lfoHz = (v: number) => 0.05 * Math.pow(600, v); // 0.05Hz .. 30Hz
export const glideSeconds = (v: number) => 0.005 * Math.pow(400, v); // 5ms .. 2s
export const resonanceQ = (v: number) => 0.5 + v * v * 20;
