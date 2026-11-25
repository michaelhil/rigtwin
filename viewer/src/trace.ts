// The trace on the page: every request to the shared scene (an agent's MCP tool call, the command line, another page),
// as the server reports it in the live channel's "trace" events (server/trace.ts). The activity line names the latest
// one by someone else. Trace and Settings → Agent access → Show requests open this list.
//
// One block per caller's run (its requests with less than five minutes between them), newest run first. Each row: the
// offset from the run's first request, ok or refused, the command, what happened in the server's words, and the
// server's time; between two requests of an agent, the time the agent itself took (its thinking, as seen from here).
// A row opens to the request as sent, the reply as the caller saw it, the picture's size and times, and for a change its
// version, request name and an Undo. Kept in this page only (the last 200); nothing is stored.
import { $, el } from './engine.ts';

export interface TraceRec {
  n: number; at: string; by: string; kind: 'person' | 'agent' | 'script' | 'system'; actor: string; via: 'mcp' | 'http';
  command: string; ok: boolean; code?: string; summary: string; ms: number; after_ms?: number;
  version?: number; request?: string; picture?: { bytes: number; wait_ms: number; page_ms?: number } | null;
  detail: { args: unknown; session?: string; reply: string }; dropped?: number;
}

const MAX = 200, RUN_GAP = 5 * 60_000;
let recs: TraceRec[] = [], dropped = 0, people = false, me = '';
const opened = new Set<number>();
let box: HTMLElement | null = null, list: HTMLElement, undoFn: (version: number) => void = () => {};

const secs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const via = (r: TraceRec) => (r.via === 'mcp' ? 'MCP' : r.kind === 'person' ? 'page' : 'command line');

export function setTraceOwner(actor: string) { me = actor; }
export const traceCount = () => recs.length;
export const lastSeen = () => recs.at(-1)?.n ?? 0;
/** A short line for the activity note: "19:42:05 · adjust · 3 ms · after 4.2 s of the agent's own time" */
export function meta(r: TraceRec): string {
  return [clock(r.at), r.via === 'mcp' ? `${r.command} (MCP)` : r.command, `server ${secs(r.ms)}`, r.picture ? `picture ${Math.round(r.picture.bytes / 1024)} kB` : '', r.kind !== 'person' && r.after_ms !== undefined && r.after_ms < RUN_GAP ? `${secs(r.after_ms)} since its last request` : ''].filter(Boolean).join(' · ');
}

export function addTrace(r: TraceRec) {
  if (recs.some((x) => x.n === r.n)) return;
  dropped += r.dropped ?? 0;
  recs.push(r); recs.sort((a, b) => a.n - b.n);
  if (recs.length > MAX) recs.splice(0, recs.length - MAX);
  if (box && !box.hidden) render();
}

/** Runs: a caller's requests with less than RUN_GAP between them; newest run first, requests oldest first inside. */
function runs(): TraceRec[][] {
  const out: TraceRec[][] = [], open = new Map<string, TraceRec[]>();
  for (const r of recs) {
    if (!people && r.kind === 'person') continue;
    const cur = open.get(r.actor), last = cur?.at(-1);
    if (cur && last && Date.parse(r.at) - Date.parse(last.at) < RUN_GAP) cur.push(r);
    else { const run = [r]; open.set(r.actor, run); out.push(run); }
  }
  return out.sort((a, b) => b.at(-1)!.n - a.at(-1)!.n);
}

function row(r: TraceRec, start: number, prev: TraceRec | undefined): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (prev && r.kind !== 'person' && r.after_ms !== undefined) {
    const gap = el('div', 'tr-gap', `${secs(r.after_ms)} on the ${r.kind === 'agent' ? "agent's" : "caller's"} side`);
    gap.title = 'time between the reply to the previous request and this request: the agent thinking, and the network';
    out.push(gap);
  }
  const line = el('button', `tr-row${r.ok ? '' : ' refused'}${opened.has(r.n) ? ' open' : ''}`) as HTMLButtonElement;
  line.type = 'button';
  line.append(el('span', 'tr-t', `+${((Date.parse(r.at) - start) / 1000).toFixed(1)} s`), el('span', 'tr-mark', r.ok ? '✓' : '!'), el('span', 'tr-cmd', r.command), el('span', 'tr-sum', r.summary), el('span', 'tr-ms', secs(r.ms)));
  line.title = `${clock(r.at)} · ${r.summary}`;
  line.addEventListener('click', () => { if (opened.has(r.n)) opened.delete(r.n); else opened.add(r.n); render(); });
  out.push(line);
  if (opened.has(r.n)) {
    const d = el('div', 'tr-detail');
    const sec = (title: string, body: string) => { d.append(el('div', 'tr-h', title)); d.append(el('pre', null, body)); };
    sec(`Request · ${clock(r.at)} · ${via(r)}${r.detail.session ? ` · for browser ${r.detail.session}` : ''}`, JSON.stringify(r.detail.args ?? {}, null, 1));
    sec(r.ok ? 'Reply, as the caller saw it' : `Refused (${r.code})`, r.detail.reply);
    if (r.picture !== undefined) d.append(el('p', 'tr-p', r.picture ? `Picture ${Math.round(r.picture.bytes / 1024)} kB · ${r.picture.page_ms !== undefined ? `drawn and packed by the page in ${secs(r.picture.page_ms)} · ` : ''}waited ${secs(r.picture.wait_ms)} for it` : 'No picture came back'));
    d.append(el('p', 'tr-p', `Server time ${secs(r.ms)}${r.after_ms !== undefined ? ` · ${secs(r.after_ms)} since this caller's previous reply` : ''}`));
    if (r.version !== undefined) {
      const p = el('p', 'tr-p', `Change: version ${r.version}${r.request ? ` · request ${r.request}` : ''} `);
      const b = el('button', null, 'Undo this') as HTMLButtonElement; b.type = 'button'; b.addEventListener('click', () => undoFn(r.version!));
      p.append(b); d.append(p);
    }
    out.push(d);
  }
  return out;
}

function render() {
  if (!box) return;
  list.replaceChildren();
  const rs = runs();
  if (!rs.length) list.append(el('p', 'tr-empty', people ? 'No requests yet.' : 'No requests by agents or scripts yet. Ask Claude Code to change or show something.'));
  for (const run of rs) {
    const first = run[0], last = run.at(-1)!, start = Date.parse(first.at);
    const server = run.reduce((a, r) => a + r.ms, 0), own = run.slice(1).reduce((a, r) => a + (r.after_ms ?? 0), 0);
    const head = el('div', 'tr-run');
    head.append(el('b', null, `${first.by}${first.actor === me ? ' (this page)' : ''}`), el('span', null, [
      via(first), `${run.length} request${run.length === 1 ? '' : 's'}`,
      run.length > 1 ? `${secs(Date.parse(last.at) + last.ms - start)} from first to last` : clock(first.at),
      `server ${secs(server)}`, first.kind !== 'person' && run.length > 1 ? `${first.kind === 'agent' ? 'agent' : 'caller'} ${secs(own)}` : '',
    ].filter(Boolean).join(' · ')));
    list.append(head);
    run.forEach((r, i) => list.append(...row(r, start, run[i - 1])));
  }
  if (dropped) list.append(el('p', 'tr-empty', `${dropped} request(s) not shown: the server sends at most a few a second.`));
}

export function toggleTrace(show?: boolean) {
  if (!box) {
    box = el('section', 'ui tr-box'); box.setAttribute('aria-label', 'Requests to the shared scene'); box.hidden = true;
    const head = el('div', 'tr-head');
    const peopleBox = el('label', 'check'), cb = el('input') as HTMLInputElement; cb.type = 'checkbox';
    cb.addEventListener('change', () => { people = cb.checked; render(); });
    peopleBox.append(cb, document.createTextNode('pages too'));
    const copy = el('button', null, 'Copy') as HTMLButtonElement; copy.type = 'button'; copy.title = 'Copy these requests as JSON';
    copy.addEventListener('click', () => { void navigator.clipboard?.writeText(JSON.stringify(recs.filter((r) => people || r.kind !== 'person'), null, 1)).catch(() => {}); });
    const close = el('button', null, '×') as HTMLButtonElement; close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.addEventListener('click', () => toggleTrace(false));
    head.append(el('h3', null, 'Requests to the shared scene'), peopleBox, copy, close);
    list = el('div', 'tr-list');
    box.append(head, list);
    $('notices').after(box);
  }
  box.hidden = show === undefined ? !box.hidden : !show;
  if (!box.hidden) render();
}
export function onTraceUndo(f: (version: number) => void) { undoFn = f; }
