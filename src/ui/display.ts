export interface DisplayHandle {
  el: HTMLElement;
  /** Show a parameter name + value briefly, then fall back to the idle text. */
  show(name: string, value: string): void;
  setIdle(text: string): void;
}

export function createDisplay(idle = 'FK-6'): DisplayHandle {
  const el = document.createElement('div');
  el.className = 'display';
  const name = document.createElement('span');
  name.className = 'display-name';
  const value = document.createElement('span');
  value.className = 'display-value';
  el.append(name, value);
  let idleText = idle;
  let timer: number | undefined;
  const showIdle = () => {
    name.textContent = '';
    value.textContent = idleText;
  };
  showIdle();
  return {
    el,
    show(n, v) {
      name.textContent = n;
      value.textContent = v;
      clearTimeout(timer);
      timer = window.setTimeout(showIdle, 1800);
    },
    setIdle(text) {
      idleText = text;
      if (timer === undefined) showIdle();
    },
  };
}
