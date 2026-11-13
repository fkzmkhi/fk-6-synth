import { noteName } from '../audio/note';
import { MAX_STEPS, type StepSequencer } from '../seq/sequencer';

/** 64-step grid (4 rows × 16) showing recorded steps and the playhead. */
export function createSeqGrid(seq: StepSequencer): HTMLElement {
  const el = document.createElement('div');
  el.className = 'seq-grid';
  const cells: HTMLElement[] = [];
  for (let i = 0; i < MAX_STEPS; i++) {
    const c = document.createElement('div');
    c.className = 'seq-cell';
    if (i % 16 === 0) c.classList.add('bar');
    const idx = document.createElement('i');
    idx.textContent = String(i + 1);
    const txt = document.createElement('span');
    c.append(idx, txt);
    el.appendChild(c);
    cells.push(c);
  }

  const render = () => {
    const ph = seq.currentStep;
    for (let i = 0; i < MAX_STEPS; i++) {
      const c = cells[i];
      const s = seq.steps[i];
      const txt = c.lastElementChild as HTMLElement;
      c.classList.toggle('empty', !s);
      c.classList.toggle('rest', !!s && s.notes.length === 0 && !s.tie);
      c.classList.toggle('tie', !!s && s.tie);
      c.classList.toggle('play', i === ph);
      c.classList.toggle('next', seq.isRecording && i === seq.length);
      if (!s) txt.textContent = '';
      else if (s.tie) txt.textContent = '—';
      else if (s.notes.length === 0) txt.textContent = '·';
      else txt.textContent = s.notes.length === 1 ? noteName(s.notes[0]) : `${noteName(s.notes[0])}+${s.notes.length - 1}`;
    }
  };
  seq.onChange(render);
  render();
  return el;
}
