export interface LedButtonHandle {
  el: HTMLButtonElement;
  set(on: boolean): void;
  get(): boolean;
}

export interface LedButtonOptions {
  label: string;
  color?: 'blue' | 'red' | 'amber';
  /** Momentary: fires onPress, never stays lit. */
  momentary?: boolean;
}

export function createLedButton(
  opts: LedButtonOptions,
  initial: boolean,
  onChange: (on: boolean) => void,
): LedButtonHandle {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `led-btn led-${opts.color ?? 'blue'}`;
  const led = document.createElement('i');
  led.className = 'led';
  const text = document.createElement('span');
  text.textContent = opts.label;
  el.append(led, text);
  let on = initial;
  const render = () => el.classList.toggle('on', on);
  el.addEventListener('click', () => {
    if (opts.momentary) {
      el.classList.add('on');
      setTimeout(() => el.classList.remove('on'), 90);
      onChange(true);
      return;
    }
    on = !on;
    render();
    onChange(on);
  });
  render();
  return {
    el,
    set(v) {
      on = v;
      render();
    },
    get: () => on,
  };
}
