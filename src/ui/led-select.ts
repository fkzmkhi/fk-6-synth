export interface LedSelectHandle<T extends string | number> {
  el: HTMLElement;
  set(v: T): void;
  get(): T;
}

export interface LedSelectOptions<T extends string | number> {
  label?: string;
  options: readonly (readonly [T, string])[];
  /** Number of columns for the option list (default 1). */
  columns?: number;
}

export function createLedSelect<T extends string | number>(
  opts: LedSelectOptions<T>,
  initial: T,
  onChange: (v: T) => void,
): LedSelectHandle<T> {
  const el = document.createElement('div');
  el.className = 'led-select';
  if (opts.label) {
    const h = document.createElement('span');
    h.className = 'led-select-label';
    h.textContent = opts.label;
    el.appendChild(h);
  }
  const list = document.createElement('div');
  list.className = 'led-select-list';
  list.style.gridTemplateColumns = `repeat(${opts.columns ?? 1}, auto)`;
  el.appendChild(list);
  let value = initial;
  const items = new Map<T, HTMLElement>();
  for (const [v, name] of opts.options) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'led-item';
    const led = document.createElement('i');
    led.className = 'led';
    const text = document.createElement('span');
    text.textContent = name;
    item.append(led, text);
    item.addEventListener('click', () => {
      if (v === value) return;
      value = v;
      render();
      onChange(v);
    });
    list.appendChild(item);
    items.set(v, item);
  }
  const render = () => {
    for (const [v, item] of items) item.classList.toggle('on', v === value);
  };
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
