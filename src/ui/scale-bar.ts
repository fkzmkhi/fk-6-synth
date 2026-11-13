import { ROOT_NAMES, SCALES, type ScaleId, type ScaleState } from '../music/scale';
import { createLedButton } from './led-button';

function select<T extends string>(options: readonly (readonly [T, string])[], value: T, onChange: (v: T) => void) {
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

/** Key / scale selector with Lock (snap) and Degree Keys toggles. */
export function createScaleBar(scale: ScaleState): HTMLElement {
  const el = document.createElement('div');
  el.className = 'scale-bar';
  const title = document.createElement('span');
  title.className = 'midi-title';
  title.textContent = 'Scale';

  const roots = select(
    ROOT_NAMES.map((n, i) => [String(i), n] as const),
    String(scale.root),
    (v) => {
      scale.root = Number(v);
      scale.emit();
    },
  );
  const scales = select(
    (Object.keys(SCALES) as ScaleId[]).map((id) => [id, SCALES[id].name] as const),
    scale.scale,
    (v) => {
      scale.scale = v;
      scale.emit();
    },
  );
  const lock = createLedButton({ label: 'Lock' }, scale.lock, (on) => {
    scale.lock = on;
    scale.emit();
  });
  const keys = createLedButton({ label: 'Degree Keys' }, scale.degreeKeys, (on) => {
    scale.degreeKeys = on;
    scale.emit();
  });
  el.append(title, roots, scales, lock.el, keys.el);
  return el;
}
