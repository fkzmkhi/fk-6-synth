import type { SynthEngine } from '../audio/engine';
import type { ArpMode } from '../audio/params';
import type { Clock } from './clock';

/**
 * Arpeggiator. Takes over keyboard note events while enabled.
 * Supports hold (latch) via the engine's Hold switch.
 */
export class Arpeggiator {
  mode: ArpMode = 'up';
  range: 1 | 2 | 3 = 1;
  private enabled = false;
  private readonly held: number[] = []; // press order
  private readonly latched: number[] = [];
  private physicallyHeld = new Set<number>();
  private pattern: number[] = [];
  private index = 0;
  private direction = 1;
  private lastPlayed = -1;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly engine: SynthEngine,
    private readonly clock: Clock,
  ) {}

  get on() {
    return this.enabled;
  }

  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      this.unsubscribe = this.clock.onStep((t, dur) => this.step(t, dur));
      this.ensureClock();
    } else {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.held.length = 0;
      this.latched.length = 0;
      this.engine.allNotesOff();
      this.ensureClock();
    }
  }

  /** Clock runs while arp has notes (or the sequencer, handled elsewhere). */
  private ensureClock() {
    const want = this.enabled && this.notes().length > 0;
    if (want && !this.clock.running) this.clock.start();
  }

  private notes(): number[] {
    return this.held.length > 0 ? this.held : this.engine.hold ? this.latched : [];
  }

  noteOn(midi: number) {
    // New phrase after everything was released: clear latch
    if (this.physicallyHeld.size === 0 && this.held.length === 0) this.latched.length = 0;
    this.physicallyHeld.add(midi);
    if (!this.held.includes(midi)) this.held.push(midi);
    if (!this.latched.includes(midi)) this.latched.push(midi);
    this.rebuild();
    this.ensureClock();
  }

  noteOff(midi: number) {
    this.physicallyHeld.delete(midi);
    const i = this.held.indexOf(midi);
    if (i >= 0) this.held.splice(i, 1);
    if (!this.engine.hold) {
      const j = this.latched.indexOf(midi);
      if (j >= 0) this.latched.splice(j, 1);
    }
    this.rebuild();
  }

  /** Called when the Hold switch turns off. */
  holdReleased() {
    this.latched.length = 0;
    this.latched.push(...this.held);
    this.rebuild();
  }

  private rebuild() {
    const base = this.notes();
    if (base.length === 0) {
      this.pattern = [];
      return;
    }
    const sorted = this.mode === 'assign' ? [...base] : [...base].sort((a, b) => a - b);
    const spread: number[] = [];
    for (let o = 0; o < this.range; o++) for (const n of sorted) spread.push(n + 12 * o);
    this.pattern = this.mode === 'down' ? spread.reverse() : spread;
    if (this.index >= this.pattern.length) this.index = 0;
  }

  private step(t: number, dur: number) {
    if (this.lastPlayed >= 0) {
      this.engine.releaseNote(this.lastPlayed, t - 0.001);
      this.lastPlayed = -1;
    }
    const pat = this.pattern;
    if (pat.length === 0) return;
    let note: number;
    if (this.mode === 'random') {
      note = pat[Math.floor(Math.random() * pat.length)];
    } else if (this.mode === 'updown' && pat.length > 1) {
      note = pat[this.index];
      let next = this.index + this.direction;
      if (next >= pat.length) {
        this.direction = -1;
        next = pat.length - 2;
      } else if (next < 0) {
        this.direction = 1;
        next = 1;
      }
      this.index = next;
    } else {
      note = pat[this.index % pat.length];
      this.index = (this.index + 1) % pat.length;
    }
    this.engine.triggerNote(note, 0.9, t);
    this.engine.releaseNote(note, t + dur * 0.55);
    this.lastPlayed = note;
  }
}
