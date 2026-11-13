import type { TimeDiv } from '../audio/params';

const DIV_MULT: Record<TimeDiv, number> = {
  '1/4': 1,
  '1/8': 0.5,
  '1/8T': 1 / 3,
  '1/16': 0.25,
  '1/16T': 1 / 6,
  '1/32': 0.125,
};

export type StepCallback = (time: number, stepDuration: number, step: number) => void;

/**
 * Look-ahead step clock ("A Tale of Two Clocks" pattern): a coarse JS timer schedules
 * steps slightly ahead on the precise AudioContext timeline.
 */
export class Clock {
  bpm = 120;
  div: TimeDiv = '1/16';
  private timer: number | undefined;
  private nextTime = 0;
  private step = 0;
  private readonly listeners = new Set<StepCallback>();
  private static readonly LOOKAHEAD = 0.12;
  private static readonly INTERVAL = 25;

  constructor(private readonly ctx: BaseAudioContext) {}

  get running() {
    return this.timer !== undefined;
  }

  get stepDuration() {
    return (60 / this.bpm) * DIV_MULT[this.div];
  }

  onStep(fn: StepCallback) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start() {
    if (this.running) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.timer = window.setInterval(() => this.tick(), Clock.INTERVAL);
    this.tick();
  }

  stop() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick() {
    const horizon = this.ctx.currentTime + Clock.LOOKAHEAD;
    while (this.nextTime < horizon) {
      const dur = this.stepDuration;
      for (const l of this.listeners) l(this.nextTime, dur, this.step);
      this.nextTime += dur;
      this.step++;
    }
  }
}
