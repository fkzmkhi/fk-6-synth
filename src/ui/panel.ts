import type { SynthEngine } from '../audio/engine';
import { NUMERIC_META, type BoolKey, type NumericKey, type ParamKey, type PatchParams } from '../audio/params';
import type { DisplayHandle } from './display';
import { createKnob } from './knob';
import { createLedButton } from './led-button';
import { createLedSelect } from './led-select';

export type Control =
  | { kind: 'knob'; key: NumericKey; label: string; bipolar?: boolean; size?: 'sm' | 'md' | 'lg' }
  | { kind: 'btn'; key: BoolKey; label: string; color?: 'blue' | 'red' | 'amber' }
  | {
      kind: 'sel';
      key: ParamKey;
      label?: string;
      options: readonly (readonly [string | number, string])[];
      columns?: number;
    }
  | { kind: 'custom'; el: HTMLElement }
  | { kind: 'group'; label: string; items: Control[] };

export interface SectionSpec {
  title: string;
  rows: Control[][];
  /** Extra CSS class for layout tweaks. */
  className?: string;
}

/** Builds panel sections from declarative specs and keeps controls in sync with engine params. */
export class Panel {
  readonly el: HTMLElement;
  private readonly setters = new Map<ParamKey, (v: PatchParams[ParamKey]) => void>();

  constructor(
    private readonly engine: SynthEngine,
    private readonly display: DisplayHandle,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'panel';
    engine.onChange((key, value) => this.setters.get(key)?.(value));
  }

  addSection(spec: SectionSpec): HTMLElement {
    const sec = document.createElement('section');
    sec.className = `sec ${spec.className ?? ''}`;
    const h = document.createElement('h2');
    h.textContent = spec.title;
    sec.appendChild(h);
    const rows = document.createElement('div');
    rows.className = 'sec-rows';
    for (const row of spec.rows) {
      const r = document.createElement('div');
      r.className = 'sec-row';
      for (const c of row) r.appendChild(this.build(c));
      rows.appendChild(r);
    }
    sec.appendChild(rows);
    this.el.appendChild(sec);
    return sec;
  }

  build(c: Control): HTMLElement {
    const p = this.engine.params;
    switch (c.kind) {
      case 'knob': {
        const meta = NUMERIC_META[c.key];
        const k = createKnob(
          { label: c.label, ...meta, bipolar: c.bipolar ?? meta.min < 0, size: c.size },
          p[c.key],
          (v) => this.engine.setParam(c.key, v),
          (n, v) => this.display.show(n, v),
        );
        this.setters.set(c.key, (v) => k.set(v as number));
        return k.el;
      }
      case 'btn': {
        const b = createLedButton({ label: c.label, color: c.color }, p[c.key], (on) => {
          this.engine.setParam(c.key, on);
          this.display.show(c.label, on ? 'ON' : 'OFF');
        });
        this.setters.set(c.key, (v) => b.set(v as boolean));
        return b.el;
      }
      case 'sel': {
        const s = createLedSelect<string | number>(
          { label: c.label, options: c.options, columns: c.columns },
          p[c.key] as string | number,
          (v) => {
            this.engine.setParam(c.key, v as PatchParams[typeof c.key]);
            const name = c.options.find(([val]) => val === v)?.[1] ?? String(v);
            this.display.show(c.label ?? '', name);
          },
        );
        this.setters.set(c.key, (v) => s.set(v as string | number));
        return s.el;
      }
      case 'group': {
        const g = document.createElement('div');
        g.className = 'ctl-group';
        const l = document.createElement('span');
        l.className = 'ctl-group-label';
        l.textContent = c.label;
        const items = document.createElement('div');
        items.className = 'ctl-group-items';
        for (const item of c.items) items.appendChild(this.build(item));
        g.append(l, items);
        return g;
      }
      case 'custom':
        return c.el;
    }
  }
}
