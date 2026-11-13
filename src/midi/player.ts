import type { SynthEngine } from '../audio/engine';
import type { MidiSong } from './smf';

export type PlayerListener = (p: MidiPlayer) => void;

/** Plays a parsed MIDI song through the engine with look-ahead scheduling. */
export class MidiPlayer {
  song: MidiSong | null = null;
  loop = true;
  private timer: number | undefined;
  private startTime = 0; // ctx time corresponding to song time 0
  private nextIndex = 0;
  private readonly active = new Set<number>();
  private readonly listeners = new Set<PlayerListener>();
  private static readonly LOOKAHEAD = 0.15;
  private static readonly INTERVAL = 40;

  constructor(private readonly engine: SynthEngine) {}

  get playing() {
    return this.timer !== undefined;
  }

  /** Current song position in seconds (0 when stopped). */
  get position() {
    if (!this.playing || !this.song) return 0;
    return Math.min(this.song.duration, this.engine.now - this.startTime);
  }

  onChange(fn: PlayerListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const l of this.listeners) l(this);
  }

  load(song: MidiSong) {
    this.stop();
    this.song = song;
    this.emit();
  }

  play() {
    if (this.playing || !this.song || this.song.events.length === 0) return;
    this.startTime = this.engine.now + 0.05;
    this.nextIndex = 0;
    this.timer = window.setInterval(() => this.tick(), MidiPlayer.INTERVAL);
    this.tick();
    this.emit();
  }

  stop() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    const t = this.engine.now;
    for (const n of this.active) this.engine.releaseNote(n, t);
    this.active.clear();
    this.emit();
  }

  private tick() {
    const song = this.song!;
    const horizon = this.engine.now + MidiPlayer.LOOKAHEAD;
    const ev = song.events;
    while (this.nextIndex < ev.length) {
      const e = ev[this.nextIndex];
      const t = this.startTime + e.time;
      if (t > horizon) break;
      if (e.type === 'on') {
        this.engine.triggerNote(e.note, e.velocity, t);
        this.active.add(e.note);
      } else {
        this.engine.releaseNote(e.note, t);
        this.active.delete(e.note);
      }
      this.nextIndex++;
    }
    if (this.nextIndex >= ev.length) {
      const endTime = this.startTime + song.duration + 0.3;
      if (this.loop) {
        this.startTime = endTime;
        this.nextIndex = 0;
      } else if (this.engine.now >= endTime) {
        this.stop();
      }
    }
    this.emit();
  }
}
