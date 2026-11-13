import type { MidiPlayer } from '../midi/player';
import { parseSmf } from '../midi/smf';
import { createLedButton } from './led-button';

export interface MidiBarOptions {
  onMidiInToggle?: () => Promise<string[]>;
  onMessage?: (text: string) => void;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Transport strip for MIDI file playback + MIDI input toggle. */
export function createMidiBar(player: MidiPlayer, opts: MidiBarOptions = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = 'midi-bar';

  const title = document.createElement('span');
  title.className = 'midi-title';
  title.textContent = 'MIDI File';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.mid,.midi,audio/midi';
  fileInput.hidden = true;
  const load = createLedButton({ label: 'Load…', momentary: true, color: 'amber' }, false, () => fileInput.click());
  const name = document.createElement('span');
  name.className = 'midi-name';
  name.textContent = 'no file — drop a .mid anywhere';

  const play = createLedButton({ label: 'Play' }, false, (on) => (on ? player.play() : player.stop()));
  const loop = createLedButton({ label: 'Loop' }, player.loop, (on) => (player.loop = on));

  const progress = document.createElement('div');
  progress.className = 'midi-progress';
  const fill = document.createElement('div');
  progress.appendChild(fill);
  const time = document.createElement('span');
  time.className = 'midi-time';
  time.textContent = '0:00 / 0:00';

  el.append(title, load.el, fileInput, name, play.el, loop.el, progress, time);

  if (opts.onMidiInToggle) {
    const midiIn = createLedButton({ label: 'MIDI In' }, false, async (on) => {
      if (!on) return;
      try {
        const names = await opts.onMidiInToggle!();
        opts.onMessage?.(names.length ? `MIDI In: ${names.join(', ')}` : 'MIDI In: no devices (plug one in)');
      } catch (err) {
        midiIn.set(false);
        opts.onMessage?.(`MIDI In failed: ${(err as Error).message}`);
      }
    });
    el.appendChild(midiIn.el);
  }

  const loadFile = async (file: File) => {
    try {
      const song = parseSmf(await file.arrayBuffer(), file.name.replace(/\.midi?$/i, ''));
      player.load(song);
      name.textContent = `${song.name}  (${song.events.filter((e) => e.type === 'on').length} notes)`;
      opts.onMessage?.(`Loaded ${song.name}`);
    } catch (err) {
      name.textContent = `failed: ${(err as Error).message}`;
    }
  };
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void loadFile(f);
    fileInput.value = '';
  });
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('dragging-file');
  });
  window.addEventListener('dragleave', () => document.body.classList.remove('dragging-file'));
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dragging-file');
    const f = e.dataTransfer?.files?.[0];
    if (f) void loadFile(f);
  });

  player.onChange(() => {
    play.set(player.playing);
    const dur = player.song?.duration ?? 0;
    const pos = player.position;
    fill.style.width = dur ? `${(pos / dur) * 100}%` : '0%';
    time.textContent = `${fmtTime(pos)} / ${fmtTime(dur)}`;
  });
  return el;
}
