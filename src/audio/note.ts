export const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
export const isBlackKey = (midi: number) => NAMES[midi % 12].includes('#');

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
