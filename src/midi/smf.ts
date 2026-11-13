/**
 * Minimal Standard MIDI File (format 0/1) parser.
 * Produces a flat, time-sorted list of note events in seconds (tempo map applied).
 */
export interface NoteEvent {
  time: number; // seconds
  type: 'on' | 'off';
  note: number;
  velocity: number; // 0..1
  channel: number;
}

export interface MidiSong {
  name: string;
  events: NoteEvent[];
  duration: number;
}

class Reader {
  pos = 0;
  constructor(private readonly d: DataView) {}
  get eof() {
    return this.pos >= this.d.byteLength;
  }
  u8() {
    return this.d.getUint8(this.pos++);
  }
  u16() {
    const v = this.d.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  u32() {
    const v = this.d.getUint32(this.pos);
    this.pos += 4;
    return v;
  }
  str(n: number) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    return s;
  }
  vlq() {
    let v = 0;
    for (;;) {
      const b = this.u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
  }
  skip(n: number) {
    this.pos += n;
  }
}

interface RawEvent {
  tick: number;
  type: 'on' | 'off' | 'tempo';
  note?: number;
  velocity?: number;
  channel?: number;
  usPerQuarter?: number;
}

export function parseSmf(buffer: ArrayBuffer, name = 'untitled'): MidiSong {
  const r = new Reader(new DataView(buffer));
  if (r.str(4) !== 'MThd') throw new Error('Not a MIDI file');
  const headerLen = r.u32();
  const format = r.u16();
  const trackCount = r.u16();
  const division = r.u16();
  r.skip(headerLen - 6);
  if (division & 0x8000) throw new Error('SMPTE time division is not supported');
  if (format > 1) throw new Error(`Unsupported MIDI format ${format}`);

  const raw: RawEvent[] = [];
  for (let t = 0; t < trackCount && !r.eof; t++) {
    if (r.str(4) !== 'MTrk') throw new Error('Bad track chunk');
    const len = r.u32();
    const end = r.pos + len;
    let tick = 0;
    let status = 0;
    while (r.pos < end) {
      tick += r.vlq();
      let b = r.u8();
      if (b < 0x80) {
        // running status
        r.pos--;
        b = status;
      } else if (b < 0xf0) {
        status = b;
      }
      if (b === 0xff) {
        const type = r.u8();
        const l = r.vlq();
        if (type === 0x51 && l === 3) {
          const us = (r.u8() << 16) | (r.u8() << 8) | r.u8();
          raw.push({ tick, type: 'tempo', usPerQuarter: us });
        } else {
          r.skip(l);
        }
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        r.skip(r.vlq());
        continue;
      }
      const kind = b & 0xf0;
      const channel = b & 0x0f;
      switch (kind) {
        case 0x80: {
          const note = r.u8();
          r.u8();
          raw.push({ tick, type: 'off', note, velocity: 0, channel });
          break;
        }
        case 0x90: {
          const note = r.u8();
          const vel = r.u8();
          raw.push({ tick, type: vel === 0 ? 'off' : 'on', note, velocity: vel / 127, channel });
          break;
        }
        case 0xa0:
        case 0xb0:
        case 0xe0:
          r.skip(2);
          break;
        case 0xc0:
        case 0xd0:
          r.skip(1);
          break;
        default:
          // unknown system message: bail out of this track
          r.pos = end;
      }
    }
    r.pos = end;
  }

  // Stable sort by tick; tempo changes and note-offs before note-ons at the same tick.
  const order = { tempo: 0, off: 1, on: 2 };
  raw.sort((a, b) => a.tick - b.tick || order[a.type] - order[b.type]);

  const events: NoteEvent[] = [];
  let usPerQuarter = 500000;
  let lastTick = 0;
  let seconds = 0;
  for (const e of raw) {
    seconds += ((e.tick - lastTick) / division) * (usPerQuarter / 1e6);
    lastTick = e.tick;
    if (e.type === 'tempo') {
      usPerQuarter = e.usPerQuarter!;
      continue;
    }
    if (e.channel === 9) continue; // GM drums
    events.push({ time: seconds, type: e.type, note: e.note!, velocity: e.velocity!, channel: e.channel! });
  }
  return { name, events, duration: events.length ? events[events.length - 1].time : 0 };
}
