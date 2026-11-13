export interface WheelsHandle {
  el: HTMLElement;
  setBend(v: number): void; // -1..1
  setMod(v: number): void; // 0..1
}

interface WheelOpts {
  label: string;
  /** Value range mapping: bipolar wheels rest at centre and spring back. */
  bipolar: boolean;
}

function wheel(opts: WheelOpts, onChange: (v: number) => void, onTouch?: (label: string, text: string) => void) {
  const el = document.createElement('div');
  el.className = 'wheel';
  const track = document.createElement('div');
  track.className = 'wheel-track';
  const ridges = document.createElement('div');
  ridges.className = 'wheel-ridges';
  const marker = document.createElement('div');
  marker.className = 'wheel-marker';
  track.append(ridges, marker);
  const label = document.createElement('span');
  label.className = 'wheel-label';
  label.textContent = opts.label;
  el.append(track, label);

  let value = 0; // bipolar: -1..1, else 0..1
  const render = () => {
    const n = opts.bipolar ? (value + 1) / 2 : value; // 0..1, 1 = top
    marker.style.top = `${(1 - n) * 100}%`;
    ridges.style.backgroundPositionY = `${n * 60}px`;
  };
  const fmt = () => (opts.bipolar ? `${value >= 0 ? '+' : ''}${Math.round(value * 100)}` : `${Math.round(value * 100)}`);
  const set = (v: number, notify = true) => {
    value = Math.min(opts.bipolar ? 1 : 1, Math.max(opts.bipolar ? -1 : 0, v));
    render();
    if (notify) {
      onChange(value);
      onTouch?.(opts.label, fmt());
    }
  };

  let dragging = false;
  let startY = 0;
  let startVal = 0;
  el.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startVal = value;
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const span = track.clientHeight || 100;
    const delta = ((startY - e.clientY) / span) * (opts.bipolar ? 2 : 1);
    set(startVal + delta);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    if (opts.bipolar) set(0); // spring back
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      set(value + (e.deltaY > 0 ? -0.05 : 0.05));
      if (opts.bipolar) {
        clearTimeout(springTimer);
        springTimer = window.setTimeout(() => set(0), 250);
      }
    },
    { passive: false },
  );
  let springTimer: number | undefined;

  render();
  return { el, set: (v: number) => set(v, false) };
}

export function createWheels(
  onBend: (v: number) => void,
  onMod: (v: number) => void,
  onTouch?: (label: string, text: string) => void,
): WheelsHandle {
  const el = document.createElement('div');
  el.className = 'wheels';
  const bend = wheel({ label: 'Pitch', bipolar: true }, onBend, onTouch);
  const mod = wheel({ label: 'Mod', bipolar: false }, onMod, onTouch);
  el.append(bend.el, mod.el);
  return { el, setBend: bend.set, setMod: mod.set };
}
