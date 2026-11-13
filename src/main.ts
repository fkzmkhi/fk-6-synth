import './style.css';
import { SynthEngine } from './audio/engine';
import { CameraTracker } from './cam/camera';
import { isBlackKey, noteName } from './audio/note';
import type { ArpMode, FxType, LfoShape, TimeDiv } from './audio/params';
import { connectMidiInput } from './midi/input';
import { MidiPlayer } from './midi/player';
import { ScaleState } from './music/scale';
import { Arpeggiator } from './seq/arpeggiator';
import { Clock } from './seq/clock';
import { StepSequencer } from './seq/sequencer';
import { createDisplay } from './ui/display';
import { createKnob } from './ui/knob';
import { createCamBar } from './ui/cam-bar';
import { createLedButton } from './ui/led-button';
import { createMidiBar } from './ui/midi-bar';
import { createScaleBar } from './ui/scale-bar';
import { Panel } from './ui/panel';
import { createSeqGrid } from './ui/seq-grid';
import { createWheels } from './ui/wheels';

const app = document.getElementById('app')!;

// ---------------------------------------------------------------- start gate
const gate = document.createElement('button');
gate.className = 'gate';
gate.innerHTML = '<b>FK-6</b><span>six-voice polysynth — click to power on</span>';
app.appendChild(gate);
gate.addEventListener('click', async () => {
  gate.disabled = true;
  gate.querySelector('span')!.textContent = 'loading…';
  const engine = await SynthEngine.create();
  await engine.resume();
  gate.remove();
  build(engine);
});

// ---------------------------------------------------------------- option tables
const LFO_SHAPES: readonly (readonly [LfoShape, string])[] = [
  ['tri', 'Tri'],
  ['revsaw', 'Rev Saw'],
  ['saw', 'Saw'],
  ['square', 'Square'],
  ['random', 'Random'],
];
const FX_TYPES: readonly (readonly [FxType, string])[] = [
  ['off', 'Off'],
  ['bbd', 'BBD Dly'],
  ['ddl', 'Dig Dly'],
  ['chorus', 'Chorus'],
  ['phaser', 'Phaser'],
  ['ringmod', 'Ring Mod'],
  ['hall', 'Hall'],
  ['room', 'Room'],
  ['plate', 'Plate'],
  ['spring', 'Spring'],
];
const ARP_MODES: readonly (readonly [ArpMode, string])[] = [
  ['up', 'Up'],
  ['down', 'Down'],
  ['updown', 'Up+Down'],
  ['random', 'Random'],
  ['assign', 'Assign'],
];
const TIME_DIVS: readonly (readonly [TimeDiv, string])[] = [
  ['1/4', '1/4'],
  ['1/8', '1/8'],
  ['1/8T', '1/8T'],
  ['1/16', '1/16'],
  ['1/16T', '1/16T'],
  ['1/32', '1/32'],
];

// ---------------------------------------------------------------- build
function build(engine: SynthEngine) {
  const clock = new Clock(engine.ctx);
  const arp = new Arpeggiator(engine, clock);
  const seq = new StepSequencer(engine, clock);
  const display = createDisplay('FK-6');
  const panel = new Panel(engine, display);

  // ---- header: logo, display, master ----
  const header = document.createElement('header');
  header.className = 'head';
  const logo = document.createElement('div');
  logo.className = 'logo';
  logo.innerHTML = '<b>FK-6</b><span>POLYPHONIC ANALOG-STYLE SYNTHESIZER</span>';
  const master = createKnob(
    { label: 'Master', min: 0, max: 1, format: (v) => `${Math.round(v * 100)}`, size: 'lg' },
    0.7,
    (v) => engine.setMasterVolume(v),
    (n, v) => display.show(n, v),
  );
  const hold = createLedButton({ label: 'Hold' }, false, (on) => {
    engine.setHold(on);
    if (!on) arp.holdReleased();
    display.show('Hold', on ? 'ON' : 'OFF');
  });
  const holdWrap = document.createElement('div');
  holdWrap.className = 'head-btns';
  holdWrap.append(hold.el);
  header.append(logo, display.el, holdWrap, master.el);
  app.appendChild(header);
  app.appendChild(panel.el);

  // ---- sections (left → right, mirroring the hardware layout) ----
  panel.addSection({
    title: 'Voice',
    className: 'span-4',
    rows: [
      [
        {
          kind: 'group',
          label: '',
          items: [
            { kind: 'btn', key: 'unison', label: 'Unison' },
            { kind: 'btn', key: 'glideOn', label: 'Glide' },
          ],
        },
        { kind: 'knob', key: 'unisonDetune', label: 'Detune', size: 'sm' },
        { kind: 'knob', key: 'glideRate', label: 'Glide', size: 'sm' },
        { kind: 'knob', key: 'slop', label: 'Slop', size: 'sm' },
      ],
    ],
  });

  panel.addSection({
    title: 'Poly Mod',
    className: 'span-5',
    rows: [
      [
        { kind: 'knob', key: 'pmFEnvAmt', label: 'Filt Env' },
        { kind: 'knob', key: 'pmOsc2Amt', label: 'Osc 2' },
        {
          kind: 'group',
          label: 'Destination',
          items: [
            { kind: 'btn', key: 'pmOsc1Freq', label: 'Osc1 Freq' },
            { kind: 'btn', key: 'pmOsc1Shape', label: 'Osc1 Shape' },
            { kind: 'btn', key: 'pmLpf', label: 'Low-Pass' },
            { kind: 'btn', key: 'pmHpf', label: 'High-Pass' },
          ],
        },
      ],
    ],
  });

  panel.addSection({
    title: 'LFO',
    className: 'span-8',
    rows: [
      [
        { kind: 'knob', key: 'lfoFreq', label: 'Frequency' },
        { kind: 'knob', key: 'lfoAmt', label: 'Init Amt' },
        { kind: 'sel', key: 'lfoShape', label: 'Shape', options: LFO_SHAPES },
        {
          kind: 'group',
          label: 'Destination',
          items: [
            { kind: 'btn', key: 'lfoOsc1', label: 'Osc1 Freq' },
            { kind: 'btn', key: 'lfoOsc2', label: 'Osc2 Freq' },
            { kind: 'btn', key: 'lfoPw', label: 'Pulse W' },
            { kind: 'btn', key: 'lfoLpf', label: 'Low-Pass' },
            { kind: 'btn', key: 'lfoHpf', label: 'High-Pass' },
            { kind: 'btn', key: 'lfoAmp', label: 'Amp' },
          ],
        },
      ],
    ],
  });

  panel.addSection({
    title: 'Oscillators',
    className: 'span-7',
    rows: [
      [
        { kind: 'knob', key: 'osc1Freq', label: 'Osc1 Freq' },
        { kind: 'knob', key: 'osc1Shape', label: 'Shape' },
        { kind: 'knob', key: 'osc1Pw', label: 'Pulse W' },
        { kind: 'btn', key: 'osc1Sync', label: 'Sync' },
      ],
      [
        { kind: 'knob', key: 'osc2Freq', label: 'Osc2 Freq' },
        { kind: 'knob', key: 'osc2Fine', label: 'Fine' },
        { kind: 'knob', key: 'osc2Shape', label: 'Shape' },
        { kind: 'knob', key: 'osc2Pw', label: 'Pulse W' },
        {
          kind: 'group',
          label: '',
          items: [
            { kind: 'btn', key: 'osc2LowFreq', label: 'Low Freq' },
            { kind: 'btn', key: 'osc2KeyTrack', label: 'Key Track' },
          ],
        },
      ],
    ],
  });

  panel.addSection({
    title: 'Mixer',
    className: 'span-4',
    rows: [
      [
        { kind: 'knob', key: 'mixOsc1', label: 'Osc 1' },
        { kind: 'knob', key: 'mixOsc2', label: 'Osc 2' },
        { kind: 'knob', key: 'mixSub', label: 'Sub Osc' },
        { kind: 'knob', key: 'mixNoise', label: 'Noise' },
      ],
    ],
  });

  panel.addSection({
    title: 'Low-Pass Filter',
    className: 'span-6',
    rows: [
      [
        { kind: 'knob', key: 'lpfCutoff', label: 'Cutoff', size: 'lg' },
        { kind: 'knob', key: 'lpfRes', label: 'Resonance' },
        { kind: 'knob', key: 'lpfEnvAmt', label: 'Env Amt' },
        { kind: 'btn', key: 'lpfVelocity', label: 'Velocity' },
        {
          kind: 'sel',
          key: 'lpfKeyTrack',
          label: 'Key Amt',
          options: [
            ['off', 'Off'],
            ['half', 'Half'],
            ['full', 'Full'],
          ],
          columns: 1,
        },
      ],
    ],
  });

  panel.addSection({
    title: 'High-Pass Filter',
    className: 'span-4',
    rows: [
      [
        { kind: 'knob', key: 'hpfCutoff', label: 'Cutoff' },
        { kind: 'knob', key: 'hpfRes', label: 'Resonance' },
        { kind: 'knob', key: 'hpfEnvAmt', label: 'Env Amt' },
      ],
    ],
  });

  panel.addSection({
    title: 'Filter Envelope',
    className: 'span-4',
    rows: [
      [
        { kind: 'knob', key: 'fAttack', label: 'Attack' },
        { kind: 'knob', key: 'fDecay', label: 'Decay' },
        { kind: 'knob', key: 'fSustain', label: 'Sustain' },
        { kind: 'knob', key: 'fRelease', label: 'Release' },
      ],
    ],
  });

  panel.addSection({
    title: 'Amplifier Envelope',
    className: 'span-6',
    rows: [
      [
        { kind: 'knob', key: 'aAttack', label: 'Attack' },
        { kind: 'knob', key: 'aDecay', label: 'Decay' },
        { kind: 'knob', key: 'aSustain', label: 'Sustain' },
        { kind: 'knob', key: 'aRelease', label: 'Release' },
        { kind: 'btn', key: 'aVelocity', label: 'Velocity' },
      ],
    ],
  });

  panel.addSection({
    title: 'Effects',
    className: 'span-13',
    rows: [
      [
        { kind: 'btn', key: 'fxOn', label: 'On' },
        { kind: 'knob', key: 'distortion', label: 'Distortion' },
        { kind: 'sel', key: 'fx1Type', label: 'FX 1', options: FX_TYPES, columns: 2 },
        { kind: 'knob', key: 'fx1Mix', label: 'Mix', size: 'sm' },
        { kind: 'knob', key: 'fx1P1', label: 'Param 1', size: 'sm' },
        { kind: 'knob', key: 'fx1P2', label: 'Param 2', size: 'sm' },
        { kind: 'sel', key: 'fx2Type', label: 'FX 2', options: FX_TYPES, columns: 2 },
        { kind: 'knob', key: 'fx2Mix', label: 'Mix', size: 'sm' },
        { kind: 'knob', key: 'fx2P1', label: 'Param 1', size: 'sm' },
        { kind: 'knob', key: 'fx2P2', label: 'Param 2', size: 'sm' },
      ],
    ],
  });

  // ---- Arp / Seq section with transport buttons ----
  const play = createLedButton({ label: 'Play' }, false, (on) => (on ? seq.play() : seq.stop()));
  const rec = createLedButton({ label: 'Record', color: 'red' }, false, (on) => seq.setRecording(on));
  const rest = createLedButton({ label: 'Rest', momentary: true }, false, () => seq.rest());
  const tie = createLedButton({ label: 'Tie', momentary: true }, false, () => seq.tie());
  const clear = createLedButton({ label: 'Clear', momentary: true, color: 'amber' }, false, () => seq.clear());
  seq.onChange(() => {
    play.set(seq.isPlaying);
    rec.set(seq.isRecording);
    display.setIdle(seq.isRecording ? `REC ${seq.length}/64` : seq.isPlaying ? `SEQ ${seq.currentStep + 1}/${seq.length}` : 'FK-6');
  });

  panel.addSection({
    title: 'Arpeggiator / Sequencer',
    className: 'sec-arp span-11',
    rows: [
      [
        { kind: 'btn', key: 'arpOn', label: 'Arp On' },
        { kind: 'sel', key: 'arpMode', label: 'Mode', options: ARP_MODES },
        {
          kind: 'sel',
          key: 'arpRange',
          label: 'Range',
          options: [
            [1, '1 Oct'],
            [2, '2 Oct'],
            [3, '3 Oct'],
          ],
        },
        { kind: 'knob', key: 'bpm', label: 'BPM' },
        { kind: 'sel', key: 'timeDiv', label: 'Time', options: TIME_DIVS, columns: 2 },
        {
          kind: 'group',
          label: 'Sequencer',
          items: [
            { kind: 'custom', el: play.el },
            { kind: 'custom', el: rec.el },
            { kind: 'custom', el: rest.el },
            { kind: 'custom', el: tie.el },
            { kind: 'custom', el: clear.el },
          ],
        },
      ],
    ],
  });

  // ---- wiring: params → arp / clock ----
  clock.bpm = engine.params.bpm;
  clock.div = engine.params.timeDiv;
  arp.mode = engine.params.arpMode;
  arp.range = engine.params.arpRange;
  engine.onChange((key, value) => {
    switch (key) {
      case 'arpOn':
        arp.setEnabled(value as boolean);
        break;
      case 'arpMode':
        arp.mode = value as ArpMode;
        break;
      case 'arpRange':
        arp.range = value as 1 | 2 | 3;
        break;
      case 'bpm':
        clock.bpm = value as number;
        break;
      case 'timeDiv':
        clock.div = value as TimeDiv;
        break;
    }
  });

  // ---- keyboard + sequencer grid ----
  const bottom = document.createElement('div');
  bottom.className = 'bottom';
  app.appendChild(bottom);
  const scale = new ScaleState();
  scale.onChange(() => {
    engine.allNotesOff();
    display.show('Scale', scale.label);
  });
  const noteOn = (m: number, vel: number) => {
    m = scale.snap(m);
    seq.recordNoteOn(m);
    if (arp.on && !seq.isRecording) arp.noteOn(m);
    else engine.noteOn(m, vel);
  };
  const noteOff = (m: number) => {
    m = scale.snap(m);
    seq.recordNoteOff(m);
    if (arp.on && !seq.isRecording) arp.noteOff(m);
    else engine.noteOff(m);
  };
  const player = new MidiPlayer(engine);
  const midiBar = createMidiBar(player, {
    onMidiInToggle: () => connectMidiInput(engine, { noteOn, noteOff }),
    onMessage: (text) => display.show('MIDI', text),
  });
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.append(
    midiBar,
    createScaleBar(scale),
    createCamBar(engine, new CameraTracker(), scale, { noteOn, noteOff }, (t) => display.show('Camera', t)),
  );
  app.insertBefore(toolbar, bottom);
  const wheels = createWheels(
    (v) => engine.setPitchBend(v),
    (v) => engine.setModWheel(v),
    (n, v) => display.show(n, v),
  );
  engine.onWheel((bend, mod) => {
    wheels.setBend(bend);
    wheels.setMod(mod);
  });
  bottom.appendChild(wheels.el);
  bottom.appendChild(buildKeyboard(noteOn, noteOff, scale));
  bottom.appendChild(createSeqGrid(seq));

  const help = document.createElement('p');
  help.className = 'help';
  help.textContent = 'Keys: A W S E D F T G Y H U J K O L P ; \'  ·  Z / X octave  ·  knobs: drag / wheel / double-click reset / shift = fine';
  app.appendChild(help);
}

// ---------------------------------------------------------------- keyboard
const KEYMAP: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};
const DEGREE_ROW_LOW = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'];
const DEGREE_ROW_HIGH = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft'];

function buildKeyboard(noteOn: (m: number, vel: number) => void, noteOff: (m: number) => void, scale: ScaleState): HTMLElement {
  const LOW = 48; // C3
  const COUNT = 37; // to C6
  const kb = document.createElement('div');
  kb.className = 'keyboard';
  const keys = new Map<number, HTMLElement>();
  let whiteIndex = 0;
  for (let m = LOW; m < LOW + COUNT; m++) {
    const k = document.createElement('div');
    const black = isBlackKey(m);
    k.className = black ? 'key black' : 'key white';
    k.dataset.midi = String(m);
    if (black) k.style.left = `calc(${whiteIndex} * var(--wk) - var(--bk) / 2)`;
    else whiteIndex++;
    if (!black && m % 12 === 0) k.textContent = noteName(m);
    kb.appendChild(k);
    keys.set(m, k);
  }
  kb.style.setProperty('--white-count', String(whiteIndex));

  const paintScale = () => {
    for (const [m, k] of keys) {
      k.classList.toggle('in-scale', scale.inScale(m));
      k.classList.toggle('root', scale.isRoot(m));
    }
  };
  scale.onChange(paintScale);
  paintScale();

  const on = (m: number, vel = 1) => {
    noteOn(m, vel);
    keys.get(scale.snap(m))?.classList.add('active');
  };
  const off = (m: number) => {
    noteOff(m);
    keys.get(scale.snap(m))?.classList.remove('active');
  };

  let pointerNote = -1;
  const noteFromEvent = (e: PointerEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const m = el?.dataset.midi;
    return m ? Number(m) : -1;
  };
  kb.addEventListener('pointerdown', (e) => {
    kb.setPointerCapture(e.pointerId);
    const m = noteFromEvent(e);
    if (m < 0) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const vel = 0.4 + 0.6 * Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    pointerNote = m;
    on(m, vel);
  });
  kb.addEventListener('pointermove', (e) => {
    if (pointerNote < 0) return;
    const m = noteFromEvent(e);
    if (m >= 0 && m !== pointerNote) {
      off(pointerNote);
      pointerNote = m;
      on(m, 0.8);
    }
  });
  const release = () => {
    if (pointerNote >= 0) off(pointerNote);
    pointerNote = -1;
  };
  kb.addEventListener('pointerup', release);
  kb.addEventListener('pointercancel', release);

  // PC keyboard: chromatic (piano-style rows) or scale degrees (two rows, upper = +1 octave)
  let octave = 60;
  const down = new Map<string, number>();
  const codeToMidi = (code: string): number | undefined => {
    if (scale.degreeKeys) {
      const lo = DEGREE_ROW_LOW.indexOf(code);
      if (lo >= 0) return scale.degreeToMidi(lo, octave);
      const hi = DEGREE_ROW_HIGH.indexOf(code);
      if (hi >= 0) return scale.degreeToMidi(hi + scale.intervals.length, octave);
      return undefined;
    }
    const n = KEYMAP[code];
    return n === undefined ? undefined : octave + n;
  };
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.code === 'KeyZ') octave = Math.max(24, octave - 12);
    else if (e.code === 'KeyX') octave = Math.min(96, octave + 12);
    const midi = codeToMidi(e.code);
    if (midi === undefined) return;
    e.preventDefault();
    down.set(e.code, midi);
    on(midi, 0.9);
  });
  window.addEventListener('keyup', (e) => {
    const midi = down.get(e.code);
    if (midi === undefined) return;
    down.delete(e.code);
    off(midi);
  });
  window.addEventListener('blur', () => {
    for (const midi of down.values()) off(midi);
    down.clear();
  });
  return kb;
}
