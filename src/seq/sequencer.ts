import type { SynthEngine } from '../audio/engine';
import type { Clock } from './clock';

export interface SeqStep {
  notes: number[]; // empty = rest
  tie: boolean; // continue previous step's notes without retrigger
}

export const MAX_STEPS = 64;

export type SeqListener = (seq: StepSequencer) => void;

/**
 * 64-step polyphonic step sequencer with hardware-style step recording:
 * play a note/chord to fill the next step, REST inserts a silent step, TIE extends the previous step.
 */
export class StepSequencer {
  readonly steps: SeqStep[] = [];
  private playing = false;
  private recording = false;
  private pos = 0;
  private playhead = -1;
  private chord = new Set<number>();
  private chordDown = new Set<number>();
  private sounding: number[] = [];
  private unsubscribe: (() => void) | null = null;
  private readonly listeners = new Set<SeqListener>();

  constructor(
    private readonly engine: SynthEngine,
    private readonly clock: Clock,
  ) {}

  get isPlaying() {
    return this.playing;
  }
  get isRecording() {
    return this.recording;
  }
  get currentStep() {
    return this.playhead;
  }
  get length() {
    return this.steps.length;
  }

  onChange(fn: SeqListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const l of this.listeners) l(this);
  }

  // ---------- transport ----------

  play() {
    if (this.playing || this.steps.length === 0) return;
    this.playing = true;
    this.recording = false;
    this.pos = 0;
    this.unsubscribe = this.clock.onStep((t, dur) => this.step(t, dur));
    if (!this.clock.running) this.clock.start();
    this.emit();
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    const t = this.engine.now;
    for (const n of this.sounding) this.engine.releaseNote(n, t);
    this.sounding = [];
    this.playhead = -1;
    this.emit();
  }

  setRecording(on: boolean) {
    if (on) this.stop();
    this.recording = on;
    if (on) {
      this.steps.length = 0;
      this.chord.clear();
      this.chordDown.clear();
    }
    this.emit();
  }

  clear() {
    this.stop();
    this.steps.length = 0;
    this.emit();
  }

  // ---------- recording ----------

  /** Keyboard input while recording. Returns true if consumed. */
  recordNoteOn(midi: number) {
    if (!this.recording) return false;
    if (this.chordDown.size === 0) this.chord.clear();
    this.chord.add(midi);
    this.chordDown.add(midi);
    return true;
  }

  recordNoteOff(midi: number) {
    if (!this.recording) return false;
    this.chordDown.delete(midi);
    if (this.chordDown.size === 0 && this.chord.size > 0) {
      this.push({ notes: [...this.chord].sort((a, b) => a - b), tie: false });
      this.chord.clear();
    }
    return true;
  }

  rest() {
    if (!this.recording) return;
    this.push({ notes: [], tie: false });
  }

  tie() {
    if (!this.recording || this.steps.length === 0) return;
    const prev = this.steps[this.steps.length - 1];
    this.push({ notes: prev.notes, tie: prev.notes.length > 0 });
  }

  private push(step: SeqStep) {
    if (this.steps.length >= MAX_STEPS) {
      this.recording = false;
      this.emit();
      return;
    }
    this.steps.push(step);
    if (this.steps.length >= MAX_STEPS) this.recording = false;
    this.emit();
  }

  // ---------- playback ----------

  private step(t: number, dur: number) {
    if (this.steps.length === 0) return;
    const i = this.pos % this.steps.length;
    const s = this.steps[i];
    this.pos = (i + 1) % this.steps.length;
    this.playhead = i;

    if (!s.tie) {
      for (const n of this.sounding) this.engine.releaseNote(n, t - 0.001);
      this.sounding = [];
      for (const n of s.notes) this.engine.triggerNote(n, 0.9, t);
      this.sounding = [...s.notes];
    }
    // Release before the next step unless it ties
    const next = this.steps[this.pos];
    if (!next?.tie) {
      const notes = this.sounding;
      for (const n of notes) this.engine.releaseNote(n, t + dur * 0.6);
      this.sounding = [];
    }
    const delay = Math.max(0, (t - this.engine.now) * 1000);
    window.setTimeout(() => this.emit(), delay);
  }
}
