export interface ScaleDef {
  name: string;
  intervals: number[]; // semitones from root, ascending, within one octave
}

export const SCALES: Record<string, ScaleDef> = {
  major: { name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'Natural Minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  harmMinor: { name: 'Harmonic Minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  melMinor: { name: 'Melodic Minor', intervals: [0, 2, 3, 5, 7, 9, 11] },
  dorian: { name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  majPent: { name: 'Major Pentatonic', intervals: [0, 2, 4, 7, 9] },
  minPent: { name: 'Minor Pentatonic', intervals: [0, 3, 5, 7, 10] },
  blues: { name: 'Blues', intervals: [0, 3, 5, 6, 7, 10] },
  wholeTone: { name: 'Whole Tone', intervals: [0, 2, 4, 6, 8, 10] },
  hirajoshi: { name: 'Hirajoshi', intervals: [0, 2, 3, 7, 8] },
  insen: { name: 'In-sen', intervals: [0, 1, 5, 7, 10] },
  yo: { name: 'Yo', intervals: [0, 2, 5, 7, 9] },
  chromatic: { name: 'Chromatic', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

export type ScaleId = keyof typeof SCALES;
export const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export type ScaleListener = (s: ScaleState) => void;

/** Current key/scale plus the two behaviours built on it: snapping and the scale-degree PC keyboard. */
export class ScaleState {
  root = 0; // 0..11 (C)
  scale: ScaleId = 'major';
  /** Snap played notes to the nearest scale tone. */
  lock = false;
  /** PC keyboard rows play scale degrees instead of chromatic notes. */
  degreeKeys = false;
  private readonly listeners = new Set<ScaleListener>();

  onChange(fn: ScaleListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    for (const l of this.listeners) l(this);
  }

  get intervals() {
    return SCALES[this.scale].intervals;
  }

  inScale(midi: number) {
    return this.intervals.includes((((midi - this.root) % 12) + 12) % 12);
  }

  isRoot(midi: number) {
    return (((midi - this.root) % 12) + 12) % 12 === 0;
  }

  /** Nearest scale tone (ties resolve downward). Identity when lock is off. */
  snap(midi: number) {
    if (!this.lock || this.inScale(midi)) return midi;
    for (let d = 1; d < 12; d++) {
      if (this.inScale(midi - d)) return midi - d;
      if (this.inScale(midi + d)) return midi + d;
    }
    return midi;
  }

  /** MIDI note for scale degree `degree` (0-based, may exceed one octave) above `baseOctaveMidi` (a C). */
  degreeToMidi(degree: number, baseOctaveMidi: number) {
    const n = this.intervals.length;
    const oct = Math.floor(degree / n);
    const idx = ((degree % n) + n) % n;
    return baseOctaveMidi + this.root + oct * 12 + this.intervals[idx];
  }

  get label() {
    return `${ROOT_NAMES[this.root]} ${SCALES[this.scale].name}`;
  }
}
