/**
 * ADSR envelope rendered as a control signal on a ConstantSourceNode.
 * Connect `output` through a GainNode (amount) to any AudioParam.
 */
export interface AdsrValues {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export class Envelope {
  readonly output: ConstantSourceNode;
  private readonly param: AudioParam;
  adsr: AdsrValues = { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3 };

  constructor(ctx: BaseAudioContext) {
    this.output = new ConstantSourceNode(ctx, { offset: 0 });
    this.param = this.output.offset;
    this.output.start();
  }

  private hold(t: number) {
    const p = this.param as AudioParam & { cancelAndHoldAtTime?: (t: number) => void };
    if (typeof p.cancelAndHoldAtTime === 'function') {
      p.cancelAndHoldAtTime(t);
    } else {
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
    }
  }

  /** Start attack at time t, rising to `peak`, decaying to sustain*peak. */
  trigger(t: number, peak = 1) {
    const { attack, decay, sustain } = this.adsr;
    this.hold(t);
    // Short settle to avoid clicks when retriggering from a non-zero level
    this.param.linearRampToValueAtTime(peak, t + Math.max(attack, 0.001));
    this.param.setTargetAtTime(sustain * peak, t + Math.max(attack, 0.001), Math.max(decay, 0.005) / 3);
  }

  release(t: number) {
    this.hold(t);
    this.param.setTargetAtTime(0, t, Math.max(this.adsr.release, 0.005) / 3);
  }

  /** Force to zero immediately (voice steal). */
  kill(t: number) {
    this.hold(t);
    this.param.setTargetAtTime(0, t, 0.003);
  }

  /** Seconds after release until the level is effectively silent. */
  get releaseTail() {
    return Math.max(this.adsr.release, 0.005) * 2 + 0.05;
  }
}
