// One small dialog for every question the workspace pages ask (rename, new workspace, delete, bulk delete): the browser's own
// <dialog>, which traps the keyboard focus, closes on Escape and gives focus back to what opened it. The question may carry
// a text field; `run` does the work (a server call) and answers null when it is done or a plain sentence when it failed, which
// then stays in the dialog so the person can try again or cancel. No import from the engine.
import { h } from './dom.ts';

export interface Ask {
  title: string;
  /** a sentence under the title */
  body?: string;
  /** a text field, with its label, first value and the longest text */
  field?: { label: string; value?: string; placeholder?: string; max: number };
  confirm: string;
  /** the confirming button is the dangerous one (a delete): it is not the first thing the keyboard reaches */
  danger?: boolean;
  /** does what the dialog asks for; null when done, else what went wrong */
  run: (value: string) => Promise<string | null>;
}

/** Resolves true when the work was done, false when the person cancelled. */
export function ask(o: Ask): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = h('dialog', 'dlg'), form = h('form'), title = h('h2', null, o.title), err = h('p', 'dlg-err');
    err.setAttribute('role', 'alert'); err.hidden = true;
    dlg.setAttribute('aria-labelledby', 'dlg-title'); title.id = 'dlg-title';
    form.append(title);
    if (o.body) form.append(h('p', 'dlg-body', o.body));
    let input: HTMLInputElement | null = null;
    if (o.field) {
      const label = h('label', 'dlg-field'); input = h('input'); input.type = 'text'; input.maxLength = o.field.max; input.value = o.field.value ?? '';
      input.placeholder = o.field.placeholder ?? ''; input.autocomplete = 'off'; input.spellcheck = false;
      label.append(h('span', null, o.field.label), input); form.append(label);
    }
    form.append(err);
    const cancel = h('button', null, 'Cancel'), ok = h('button', o.danger ? 'primary danger' : 'primary', o.confirm);
    cancel.type = 'button'; ok.type = 'submit';
    form.append(h('div', 'dlg-acts', cancel, ok));
    dlg.append(form);
    let done = false;
    const finish = (r: boolean) => { if (done) return; done = true; dlg.close(); dlg.remove(); resolve(r); };
    cancel.addEventListener('click', () => finish(false));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (!ok.disabled) finish(false); });          // Escape (not while the work is under way)
    dlg.addEventListener('click', (e) => { if (e.target === dlg && !ok.disabled) finish(false); });           // a click on the dimmed page
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (ok.disabled) return;
      ok.disabled = true; cancel.disabled = true; err.hidden = true; ok.dataset.label = ok.textContent ?? ''; ok.textContent = 'Working…';
      const problem = await o.run(input?.value ?? '').catch(() => 'Something went wrong. Try again.');
      ok.disabled = false; cancel.disabled = false; ok.textContent = ok.dataset.label ?? o.confirm;
      if (problem === null) finish(true);
      else { err.textContent = problem; err.hidden = false; (input ?? cancel).focus(); }
    });
    document.body.append(dlg);
    dlg.showModal();
    if (input) { input.focus(); input.select(); } else cancel.focus();
  });
}
