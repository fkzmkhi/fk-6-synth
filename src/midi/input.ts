import type { SynthEngine } from '../audio/engine';

export interface MidiInputHandlers {
  noteOn(midi: number, velocity: number): void;
  noteOff(midi: number): void;
}

/** Web MIDI input: note on/off, mod wheel (CC1), pitch bend, sustain (CC64 → hold). */
export async function connectMidiInput(engine: SynthEngine, handlers: MidiInputHandlers): Promise<string[]> {
  if (!('requestMIDIAccess' in navigator)) throw new Error('Web MIDI is not supported in this browser');
  const access = await navigator.requestMIDIAccess({ sysex: false });
  const names: string[] = [];
  const attach = (input: MIDIInput) => {
    names.push(input.name ?? 'MIDI input');
    input.onmidimessage = (e) => {
      const d = e.data;
      if (!d || d.length < 2) return;
      const kind = d[0] & 0xf0;
      switch (kind) {
        case 0x90:
          if (d[2] > 0) handlers.noteOn(d[1], d[2] / 127);
          else handlers.noteOff(d[1]);
          break;
        case 0x80:
          handlers.noteOff(d[1]);
          break;
        case 0xb0:
          if (d[1] === 1) engine.setModWheel(d[2] / 127);
          else if (d[1] === 64) engine.setHold(d[2] >= 64);
          else if (d[1] === 123 || d[1] === 120) engine.allNotesOff();
          break;
        case 0xe0: {
          const v = ((d[2] << 7) | d[1]) - 8192;
          engine.setPitchBend(v / 8192);
          break;
        }
      }
    };
  };
  for (const input of access.inputs.values()) attach(input);
  access.onstatechange = (e) => {
    const port = e.port;
    if (port && port.type === 'input' && port.state === 'connected' && !(port as MIDIInput).onmidimessage) attach(port as MIDIInput);
  };
  return names;
}
