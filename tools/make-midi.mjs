#!/usr/bin/env node
/**
 * Tiny Standard MIDI File writer + text-notation front end.
 *
 *   node tools/make-midi.mjs song.json out.mid
 *   node tools/make-midi.mjs --demo out.mid        (writes the bundled original demo piece)
 *
 * song.json:
 * {
 *   "bpm": 66,
 *   "tracks": [
 *     { "name": "melody", "notes": "C#5:1 E5:1 F#5:2 | A5:1.5 F#5:.5 E5:2" },
 *     { "name": "bass",   "notes": [[0, 0.5, "F#2", 80], [0.5, 0.5, "C#3", 70]] }
 *   ]
 * }
 *
 * Notation string: tokens separated by spaces; "|" is ignored (bar line, for readability).
 *   NOTE:DUR        e.g. A4:1   (DUR in beats, default 1)
 *   r:DUR           rest
 *   [A4,C#5,E5]:2   chord
 *   NOTE:DUR@VEL    velocity 1..127 (default 96)
 * Array form: [startBeat, durationBeats, note, velocity?]
 */
import { writeFileSync, readFileSync } from 'node:fs';

const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteNumber(n) {
  if (typeof n === 'number') return n;
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(n.trim());
  if (!m) throw new Error(`bad note "${n}"`);
  const semi = NAMES[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return (Number(m[3]) + 1) * 12 + semi;
}

/** Parse notation string into [start, dur, note, vel] tuples. */
export function parseNotation(text) {
  const out = [];
  let t = 0;
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    if (tok === '|') continue;
    const m = /^(\[[^\]]+\]|[^:@]+)(?::([\d.]+))?(?:@(\d+))?$/.exec(tok);
    if (!m) throw new Error(`bad token "${tok}"`);
    const dur = m[2] ? Number(m[2]) : 1;
    const vel = m[3] ? Number(m[3]) : 96;
    if (m[1] !== 'r') {
      const names = m[1].startsWith('[') ? m[1].slice(1, -1).split(',') : [m[1]];
      for (const n of names) out.push([t, dur, noteNumber(n), vel]);
    }
    t += dur;
  }
  return out;
}

const vlq = (n) => {
  const b = [n & 0x7f];
  while ((n >>= 7) > 0) b.unshift((n & 0x7f) | 0x80);
  return b;
};
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (id, data) => [...[...id].map((c) => c.charCodeAt(0)), ...u32(data.length), ...data];

export function buildSmf({ bpm = 120, tracks }, tpq = 480) {
  const tempo = Math.round(60_000_000 / bpm);
  const t0 = [...vlq(0), 0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255, ...vlq(0), 0xff, 0x2f, 0];
  const chunks = [chunk('MTrk', t0)];
  tracks.forEach((tr, i) => {
    const notes = typeof tr.notes === 'string' ? parseNotation(tr.notes) : tr.notes;
    const ch = tr.channel ?? i % 9;
    const events = [];
    for (const [start, dur, note, vel = 96] of notes) {
      const n = noteNumber(note);
      events.push({ tick: Math.round(start * tpq), kind: 1, bytes: [0x90 | ch, n, Math.max(1, Math.min(127, vel))] });
      events.push({ tick: Math.round((start + dur) * tpq) - 1, kind: 0, bytes: [0x80 | ch, n, 0] });
    }
    events.sort((a, b) => a.tick - b.tick || a.kind - b.kind);
    const data = [];
    if (tr.name) data.push(...vlq(0), 0xff, 0x03, tr.name.length, ...[...tr.name].map((c) => c.charCodeAt(0) & 127));
    let last = 0;
    for (const e of events) {
      data.push(...vlq(e.tick - last), ...e.bytes);
      last = e.tick;
    }
    data.push(...vlq(0), 0xff, 0x2f, 0);
    chunks.push(chunk('MTrk', data));
  });
  return Uint8Array.from([...chunk('MThd', [0, 1, 0, chunks.length, (tpq >> 8) & 255, tpq & 255]), ...chunks.flat()]);
}

// ---------------------------------------------------------------- bundled demo: "Snowlight" (original)
// A: F#m D A E ×2  /  B: D A Bm F#m D A E F#m   — slow, arpeggiated accompaniment, pentatonic-leaning melody.
const CHORDS = {
  'F#m': ['F#2', 'C#3', 'F#3', 'A3', 'C#4'],
  D: ['D2', 'A2', 'D3', 'F#3', 'A3'],
  A: ['A2', 'E3', 'A3', 'C#4', 'E4'],
  E: ['E2', 'B2', 'E3', 'G#3', 'B3'],
  Bm: ['B2', 'F#3', 'B3', 'D4', 'F#4'],
};
const PROG = ['F#m', 'D', 'A', 'E', 'F#m', 'D', 'A', 'E', 'D', 'A', 'Bm', 'F#m', 'D', 'A', 'E', 'F#m'];
const MELODY = [
  'C#5:1 E5:1 F#5:2', 'A5:1.5 F#5:.5 E5:2', 'C#5:1 E5:1 A5:1 B5:1', 'G#5:3 r:1',
  'F#5:1 E5:1 C#5:2', 'D5:1 E5:1 F#5:2', 'E5:1.5 C#5:.5 B4:2', 'A4:4',
  'F#5:1 A5:1 B5:2', 'A5:1.5 F#5:.5 E5:2', 'D5:1 F#5:1 B5:2', 'A5:1 F#5:1 C#5:2',
  'D5:1 E5:1 F#5:1 A5:1', 'E5:3 C#5:1', 'B4:2 G#4:2', 'A4:4',
];
const ARP = [0, 1, 2, 3, 4, 3, 2, 1];

export function demoSong() {
  const melody = [];
  const accomp = [];
  for (let pass = 0; pass < 2; pass++) {
    PROG.forEach((chord, bar) => {
      const base = (pass * 16 + bar) * 4;
      // second pass: melody an octave up, softer accompaniment
      for (const [s, d, n, v] of parseNotation(MELODY[bar])) melody.push([base + s, d * 0.95, n + (pass ? 12 : 0), v - (pass ? 8 : 0)]);
      const tones = CHORDS[chord];
      ARP.forEach((idx, i) => accomp.push([base + i * 0.5, 0.55, tones[idx], (i === 0 ? 78 : 60) - pass * 6]));
    });
  }
  // final chord
  const end = 32 * 4;
  for (const n of CHORDS['F#m']) accomp.push([end, 4, n, 70]);
  melody.push([end, 4, 'F#5', 90]);
  return { bpm: 64, tracks: [{ name: 'melody', notes: melody }, { name: 'arpeggio', notes: accomp }] };
}

// ---------------------------------------------------------------- CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) {
    console.error('usage: node tools/make-midi.mjs <song.json | --demo> <out.mid>');
    process.exit(1);
  }
  const song = src === '--demo' ? demoSong() : JSON.parse(readFileSync(src, 'utf8'));
  writeFileSync(out, buildSmf(song));
  console.log(`wrote ${out}`);
}
