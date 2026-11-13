import type { Curve } from '../audio/params';

export interface KnobSpec {
  label: string;
  min: number;
  max: number;
  step?: number;
  curve?: Curve;
  /** Draw the value arc from the centre (for -1..1 style params). */
  bipolar?: boolean;
  format?: (v: number) => string;
  size?: 'sm' | 'md' | 'lg';
}

export interface KnobHandle {
  el: HTMLElement;
  set(v: number): void;
  get(): number;
}

const SWEEP = 270; // degrees
const R = 17;
const CX = 24;
const CY = 24;
const SVG_NS = 'http://www.w3.org/2000/svg';

function polar(angleDeg: number, r: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)] as const;
}

function arcPath(fromDeg: number, toDeg: number, r: number) {
  if (Math.abs(toDeg - fromDeg) < 0.01) return '';
  const [x1, y1] = polar(fromDeg, r);
  const [x2, y2] = polar(toDeg, r);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  const sweep = toDeg > fromDeg ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweep} ${x2} ${y2}`;
}

export function createKnob(
  spec: KnobSpec,
  initial: number,
  onChange: (v: number) => void,
  onTouch?: (label: string, text: string) => void,
): KnobHandle {
  const { min, max, curve = 'lin' } = spec;
  const toNorm = (v: number) =>
    curve === 'exp' ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
  const fromNorm = (n: number) => {
    n = Math.min(1, Math.max(0, n));
    let v = curve === 'exp' ? min * Math.pow(max / min, n) : min + n * (max - min);
    if (spec.step) v = Math.round(v / spec.step) * spec.step;
    return Math.min(max, Math.max(min, v));
  };
  const fmt = spec.format ?? ((v: number) => v.toFixed(2));

  const el = document.createElement('div');
  el.className = `knob knob-${spec.size ?? 'md'}`;
  el.tabIndex = 0;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  const track = document.createElementNS(SVG_NS, 'path');
  track.setAttribute('class', 'knob-track');
  track.setAttribute('d', arcPath(-SWEEP / 2, SWEEP / 2, R + 4));
  const arc = document.createElementNS(SVG_NS, 'path');
  arc.setAttribute('class', 'knob-arc');
  const body = document.createElementNS(SVG_NS, 'circle');
  body.setAttribute('class', 'knob-body');
  body.setAttribute('cx', String(CX));
  body.setAttribute('cy', String(CY));
  body.setAttribute('r', String(R));
  const pointer = document.createElementNS(SVG_NS, 'line');
  pointer.setAttribute('class', 'knob-pointer');
  pointer.setAttribute('x1', String(CX));
  pointer.setAttribute('y1', String(CY - 4));
  pointer.setAttribute('x2', String(CX));
  pointer.setAttribute('y2', String(CY - R + 2));
  svg.append(track, arc, body, pointer);

  const label = document.createElement('span');
  label.className = 'knob-label';
  label.textContent = spec.label;
  el.append(svg, label);

  let value = initial;
  const defaultValue = initial;

  const render = () => {
    const n = toNorm(value);
    const deg = -SWEEP / 2 + n * SWEEP;
    pointer.setAttribute('transform', `rotate(${deg} ${CX} ${CY})`);
    const from = spec.bipolar ? 0 : -SWEEP / 2;
    arc.setAttribute('d', arcPath(Math.min(from, deg), Math.max(from, deg), R + 4));
    el.title = `${spec.label}: ${fmt(value)}`;
  };

  const commit = (v: number, notify = true) => {
    if (v === value) return;
    value = v;
    render();
    if (notify) {
      onChange(value);
      onTouch?.(spec.label, fmt(value));
    }
  };

  // ---- pointer drag (vertical) ----
  let dragging = false;
  let startY = 0;
  let startNorm = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    startY = e.clientY;
    startNorm = toNorm(value);
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    onTouch?.(spec.label, fmt(value));
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const px = e.shiftKey ? 1600 : 180;
    commit(fromNorm(startNorm + (startY - e.clientY) / px));
  });
  const end = () => {
    dragging = false;
    el.classList.remove('dragging');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => commit(defaultValue));
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const d = (e.deltaY > 0 ? -1 : 1) * (e.shiftKey ? 0.004 : 0.03);
      commit(fromNorm(toNorm(value) + d));
    },
    { passive: false },
  );
  el.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.02 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.02 : 0;
    if (!d) return;
    e.preventDefault();
    commit(fromNorm(toNorm(value) + d));
  });

  render();
  return {
    el,
    set(v) {
      value = v;
      render();
    },
    get: () => value,
  };
}
