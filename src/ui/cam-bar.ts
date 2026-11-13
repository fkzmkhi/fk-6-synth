import type { SynthEngine } from '../audio/engine';
import { NUMERIC_META, type NumericKey } from '../audio/params';
import type { CameraTracker, CamMetrics } from '../cam/camera';
import type { ScaleState } from '../music/scale';
import { createKnob } from './knob';
import { createLedButton } from './led-button';

type Source = keyof CamMetrics;

const SOURCES: readonly (readonly [Source, string])[] = [
  ['x', 'Pos X'],
  ['y', 'Pos Y'],
  ['motion', 'Motion'],
  ['brightness', 'Bright'],
];

const DESTS: readonly (readonly [NumericKey | 'none', string])[] = [
  ['none', '— none —'],
  ['lpfCutoff', 'LPF Cutoff'],
  ['lpfRes', 'LPF Resonance'],
  ['hpfCutoff', 'HPF Cutoff'],
  ['osc1Shape', 'Osc1 Shape'],
  ['osc1Pw', 'Osc1 Pulse W'],
  ['osc2Shape', 'Osc2 Shape'],
  ['osc2Fine', 'Osc2 Fine'],
  ['mixSub', 'Mix Sub'],
  ['mixNoise', 'Mix Noise'],
  ['lfoFreq', 'LFO Freq'],
  ['lfoAmt', 'LFO Amount'],
  ['pmOsc2Amt', 'PolyMod Osc2'],
  ['aRelease', 'Amp Release'],
  ['fRelease', 'Filt Release'],
  ['distortion', 'Distortion'],
  ['fx1Mix', 'FX1 Mix'],
  ['fx1P1', 'FX1 Param 1'],
  ['fx2Mix', 'FX2 Mix'],
  ['fx2P1', 'FX2 Param 1'],
  ['bpm', 'BPM'],
];

interface Mapping {
  source: Source;
  dest: NumericKey | 'none';
  amount: number; // -1..1
  base: number; // normalised 0..1 position captured when mapping is (re)armed
}

const toNorm = (key: NumericKey, v: number) => {
  const m = NUMERIC_META[key];
  return m.curve === 'exp' ? Math.log(v / m.min) / Math.log(m.max / m.min) : (v - m.min) / (m.max - m.min);
};
const fromNorm = (key: NumericKey, n: number) => {
  const m = NUMERIC_META[key];
  n = Math.min(1, Math.max(0, n));
  let v = m.curve === 'exp' ? m.min * Math.pow(m.max / m.min, n) : m.min + n * (m.max - m.min);
  if (m.step) v = Math.round(v / m.step) * m.step;
  return v;
};

/**
 * Webcam → parameter modulation bar.
 * Each lane: source signal → destination knob, with a bipolar amount. The knob's position when the
 * lane is armed becomes the centre; the camera sweeps ± amount/2 around it.
 */
export interface CamNoteHandlers {
  noteOn(midi: number, velocity: number): void;
  noteOff(midi: number): void;
}

const ZONE_OPTIONS = [4, 5, 6, 7, 8, 10, 12] as const;
const OCTAVES: readonly (readonly [string, string])[] = [
  ['36', 'C2'],
  ['48', 'C3'],
  ['60', 'C4'],
  ['72', 'C5'],
];

function makeSelect<T extends string>(options: readonly (readonly [T, string])[], value: T, onChange: (v: T) => void) {
  const sel = document.createElement('select');
  sel.className = 'bar-select';
  for (const [v, name] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = name;
    o.selected = v === value;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onChange(sel.value as T));
  return sel;
}

export function createCamBar(
  engine: SynthEngine,
  cam: CameraTracker,
  scale: ScaleState,
  notes: CamNoteHandlers,
  onMessage: (t: string) => void,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cam-bar';
  const title = document.createElement('span');
  title.className = 'midi-title';
  title.textContent = 'Camera';

  const preview = document.createElement('div');
  preview.className = 'cam-preview';
  cam.video.className = 'cam-video';
  const dot = document.createElement('i');
  dot.className = 'cam-dot';
  const zonesOverlay = document.createElement('div');
  zonesOverlay.className = 'cam-zones';
  preview.append(cam.video, zonesOverlay, dot);

  const lanes: Mapping[] = [
    { source: 'x', dest: 'lpfCutoff', amount: 0.8, base: 0 },
    { source: 'y', dest: 'lpfRes', amount: 0.5, base: 0 },
    { source: 'motion', dest: 'none', amount: 0.6, base: 0 },
    { source: 'brightness', dest: 'none', amount: 0.5, base: 0 },
  ];
  const arm = (m: Mapping) => {
    if (m.dest !== 'none') m.base = toNorm(m.dest, engine.params[m.dest]);
  };

  const power = createLedButton({ label: 'On', color: 'red' }, false, async (on) => {
    if (on) {
      try {
        await cam.start();
        lanes.forEach(arm);
        onMessage('Camera on — move in front of it');
      } catch (err) {
        power.set(false);
        onMessage(`Camera failed: ${(err as Error).message}`);
      }
    } else {
      cam.stop();
      onMessage('Camera off');
    }
  });

  el.append(title, power.el, preview);

  for (const lane of lanes) {
    const box = document.createElement('div');
    box.className = 'cam-lane';
    const src = document.createElement('select');
    src.className = 'bar-select';
    for (const [v, name] of SOURCES) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = name;
      o.selected = v === lane.source;
      src.appendChild(o);
    }
    src.addEventListener('change', () => (lane.source = src.value as Source));
    const arrow = document.createElement('span');
    arrow.className = 'cam-arrow';
    arrow.textContent = '→';
    const dst = document.createElement('select');
    dst.className = 'bar-select';
    for (const [v, name] of DESTS) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = name;
      o.selected = v === lane.dest;
      dst.appendChild(o);
    }
    dst.addEventListener('change', () => {
      lane.dest = dst.value as NumericKey | 'none';
      arm(lane);
    });
    const amt = createKnob(
      { label: 'Amount', min: -1, max: 1, bipolar: true, size: 'sm', format: (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}` },
      lane.amount,
      (v) => (lane.amount = v),
    );
    box.append(src, arrow, dst, amt.el);
    el.appendChild(box);
  }

  // ---------------- motion trigger: zones → scale degrees ----------------
  const trig = { on: false, mode: 'gate' as 'gate' | 'pluck', threshold: 0.25, base: 48 };
  interface ZoneState {
    active: boolean;
    midi: number;
    lastOff: number;
  }
  const zoneStates: ZoneState[] = Array.from({ length: 12 }, () => ({ active: false, midi: -1, lastOff: 0 }));
  const zoneEls: HTMLElement[] = [];
  const rebuildZones = () => {
    zonesOverlay.replaceChildren();
    zoneEls.length = 0;
    for (let z = 0; z < cam.zoneCols; z++) {
      const d = document.createElement('div');
      zonesOverlay.appendChild(d);
      zoneEls.push(d);
    }
    zonesOverlay.classList.toggle('hidden', !trig.on);
  };
  const zoneOff = (z: number) => {
    const st = zoneStates[z];
    if (!st.active) return;
    st.active = false;
    st.lastOff = performance.now();
    notes.noteOff(st.midi);
  };
  const allZonesOff = () => zoneStates.forEach((_, z) => zoneOff(z));

  const trigger = document.createElement('div');
  trigger.className = 'cam-trigger';
  const trigTitle = document.createElement('span');
  trigTitle.className = 'midi-title';
  trigTitle.textContent = 'Trigger';
  const trigOn = createLedButton({ label: 'On' }, false, (on) => {
    trig.on = on;
    if (!on) allZonesOff();
    rebuildZones();
    onMessage(on ? 'Motion trigger on — wave in a zone' : 'Motion trigger off');
  });
  const zoneSel = makeSelect(
    ZONE_OPTIONS.map((n) => [String(n), `${n} zones`] as const),
    String(cam.zoneCols),
    (v) => {
      allZonesOff();
      cam.zoneCols = Number(v);
      rebuildZones();
    },
  );
  const modeSel = makeSelect(
    [
      ['gate', 'Gate'],
      ['pluck', 'Pluck'],
    ] as const,
    trig.mode,
    (v) => {
      allZonesOff();
      trig.mode = v;
    },
  );
  const octSel = makeSelect(OCTAVES, String(trig.base), (v) => {
    allZonesOff();
    trig.base = Number(v);
  });
  // Sensitivity knob: 0 = needs big movement (threshold 0.8), 1 = hair trigger (threshold 0.05)
  const thr = createKnob(
    { label: 'Sens', min: 0, max: 1, size: 'sm', format: (v) => `${Math.round(v * 100)}` },
    (0.8 - trig.threshold) / 0.75,
    (v) => (trig.threshold = 0.8 - v * 0.75),
  );
  trigger.append(trigTitle, trigOn.el, zoneSel, modeSel, octSel, thr.el);
  el.appendChild(trigger);
  rebuildZones();

  const processTrigger = () => {
    if (!trig.on) return;
    const now = performance.now();
    const cols = cam.zoneCols;
    for (let z = 0; z < cols; z++) {
      const v = cam.zones[z];
      const st = zoneStates[z];
      const elz = zoneEls[z];
      if (elz) {
        elz.style.setProperty('--m', String(Math.min(1, v / Math.max(trig.threshold, 0.01))));
        elz.classList.toggle('active', st.active);
      }
      if (!st.active && v > trig.threshold && now - st.lastOff > 90) {
        st.active = true;
        st.midi = scale.degreeToMidi(z, trig.base);
        notes.noteOn(st.midi, Math.min(1, 0.45 + v));
        if (trig.mode === 'pluck') window.setTimeout(() => zoneOff(z), 140);
      } else if (st.active && trig.mode === 'gate' && v < trig.threshold * 0.45) {
        zoneOff(z);
      }
    }
  };

  cam.onFrame((m) => {
    processTrigger();
    dot.style.left = `${m.x * 100}%`;
    dot.style.top = `${(1 - m.y) * 100}%`;
    dot.style.opacity = String(0.3 + m.motion * 0.7);
    for (const lane of lanes) {
      if (lane.dest === 'none' || lane.amount === 0) continue;
      const sig = m[lane.source];
      const n = lane.base + lane.amount * (sig - 0.5);
      engine.setParam(lane.dest, fromNorm(lane.dest, n));
    }
  });

  return el;
}
