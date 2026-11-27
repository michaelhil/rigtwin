// The homepage: a story carousel (photo -> model -> person -> room -> assessment -> agent -> wiki) and a menu of the
// installation's workspaces. No three.js: the homepage loads only this small script and the pictures.
import { h, link } from './dom.ts';
import { PUBLIC_ROOM, ROOM_API, roomURL } from './room-paths.ts';

interface Slide { step: string; title: string; text: string; image: string; alt: string; link?: { text: string; href: string } }
const SLIDES: Slide[] = [
  { step: '1 · Photos', title: 'Start from photos of the real workplace',
    text: 'Phone photos with a ruler in view and a few measured spans are enough to begin.',
    image: '/home/1-photos.jpg', alt: 'Three photos of an operator desk, one with a metre rule on the desktop and one with measured spans on the canopy. Screens are masked.' },
  { step: '2 · Model', title: 'A measured model, part by part',
    text: 'Every part is named and every size records how it is known. Seen from the photo’s spot, model and photo agree.',
    image: '/home/2-model.jpg', alt: 'A photo of the desk beside the 3D model rendered from the same camera position.' },
  { step: '3 · Person', title: 'Adjust it like the real one, with a person in it',
    text: 'Seat, monitor, joysticks and pedals move within their ranges; a sized operator sits in the seat and follows.',
    image: '/home/3-station.jpg', alt: 'An operator station in the 3D viewer with a seated operator holding the joysticks.' },
  { step: '4 · Room', title: 'Arrange the room',
    text: 'Place stations, desks and displays around the door and the window, in 2D or 3D.',
    image: '/home/4-scene.jpg', alt: 'A control room in 3D with two operator stations, an operator desk, a freestanding display and a wall display.' },
  { step: '5 · Assessment', title: 'Measure and assess',
    text: 'Check viewing distances and clearances against cited guidelines, with an honest status for every finding.',
    image: '/home/5-assessment.jpg', alt: 'The floor plan with a viewing distance drawn at one station and the assessment findings beside it.' },
  { step: '6 · AI control', title: 'Direct it with an AI agent',
    text: 'Ask an agent such as Claude to move, adjust, measure or assess. It uses the same commands as the buttons; every change shows live and can be undone.',
    image: '/home/6-agent.jpg', alt: 'The 3D viewer with an operator station and the Activity list showing three adjustments made by an agent.',
    link: { text: 'Agent guide', href: '/llms.txt' } },
  { step: '7 · Wiki', title: 'Every step documented',
    text: 'The wiki records the method, the decisions, the measurements and how accurate they are, and what is still uncertain.',
    image: '/home/7-wiki.jpg', alt: 'The Synergon wiki: an index of all pages grouped in sections such as overview, decisions, method and results.',
    link: { text: 'Open the wiki', href: '/wiki/' } },
];
const INTERVAL = 6000;

function carousel(host: HTMLElement) {
  let index = 0, timer = 0, stopped = matchMedia('(prefers-reduced-motion: reduce)').matches, held = false;
  const slides = SLIDES.map((s, i) => {
    const img = h('img'); img.src = s.image; img.alt = s.alt; img.width = 1440; img.height = 900;
    img.loading = i === 0 ? 'eager' : 'lazy'; img.decoding = 'async';
    const text = h('span', 'home-text', s.text);
    if (s.link) text.append(' ', link(s.link.text + '\u00a0→', s.link.href));
    const slide = h('figure', 'home-slide', img, h('figcaption', null, h('span', 'home-step', s.step), h('strong', null, s.title), text));
    slide.setAttribute('role', 'group'); slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${i + 1} of ${SLIDES.length}: ${s.title}`);
    return slide;
  });
  const viewport = h('div', 'home-viewport', ...slides);
  const control = (label: string, text: string, run: () => void) => {
    const b = h('button', 'home-control', text); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label;
    b.onclick = () => { stopped = true; run(); }; return b;
  };
  const toggle = h('button', 'home-control home-toggle'); toggle.type = 'button';
  toggle.onclick = () => { stopped = !stopped; held = false; show(index); };
  const dots = SLIDES.map((s, i) => {
    const d = h('button', 'home-dot', h('span', null, s.step.replace(/^\d+ · /, ''))); d.type = 'button';
    d.setAttribute('aria-label', `Show ${s.step}: ${s.title}`); d.onclick = () => { stopped = true; show(i); };
    return d;
  });
  const controls = h('div', 'home-controls', toggle, control('Previous slide', '‹', () => show(index - 1)), h('div', 'home-dots', ...dots),
    control('Next slide', '›', () => show(index + 1)));
  host.append(viewport, controls);
  host.setAttribute('aria-roledescription', 'carousel');
  function show(next: number) {
    index = (next + SLIDES.length) % SLIDES.length;
    slides.forEach((s, i) => { const on = i === index; s.classList.toggle('on', on); s.inert = !on; s.setAttribute('aria-hidden', String(!on)); });
    dots.forEach((d, i) => d.setAttribute('aria-current', String(i === index)));
    const label = stopped ? 'Play the slides' : 'Pause the slides';
    toggle.textContent = stopped ? '▶' : '❚❚'; toggle.setAttribute('aria-label', label); toggle.title = label;
    viewport.setAttribute('aria-live', stopped ? 'polite' : 'off');
    host.classList.toggle('rotating', !stopped && !held);
    clearTimeout(timer);
    if (!stopped && !held) timer = window.setTimeout(() => show(index + 1), INTERVAL);
  }
  const hold = (on: boolean) => { held = on; show(index); };
  host.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') hold(true); });
  host.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hold(false); });
  host.addEventListener('focusin', e => { if ((e.target as Element).matches(':focus-visible')) { stopped = true; show(index); } });
  document.addEventListener('visibilitychange', () => hold(document.hidden));
  let start: { x: number; y: number } | null = null;
  viewport.addEventListener('pointerdown', e => { start = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY }; });
  viewport.addEventListener('pointerup', e => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y; start = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < Math.abs(dx) / 2) { stopped = true; show(index + (dx < 0 ? 1 : -1)); }
  });
  host.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); stopped = true; show(index + (e.key === 'ArrowRight' ? 1 : -1)); }
  });
  show(0);
}

interface Listed { id: string; name: string }
async function list(url: string): Promise<Listed[]> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(String(response.status));
  return ((await response.json()) as { workspaces: Listed[] }).workspaces;
}
/** "Open a workspace": every room of this installation and, on the public site, the older single-station workspaces. */
function workspaceMenu(host: HTMLElement) {
  const menu = h('div', 'home-ws-menu');
  const details = h('details', 'home-ws', h('summary', null, 'Open a workspace'), menu);
  host.replaceWith(details);
  let loaded = false;
  details.addEventListener('toggle', async () => {
    if (!details.open || loaded) return;
    menu.replaceChildren(h('p', 'home-ws-note', 'Loading…'));
    try {
      const [rooms, stations] = await Promise.all([list(ROOM_API + '/workspaces?limit=100'), PUBLIC_ROOM ? list('/api/workspaces?limit=100').catch(() => []) : Promise.resolve([])]);
      const group = (title: string, items: Listed[], href: (id: string) => string) =>
        items.length ? [h('p', 'home-ws-head', title), ...items.map(w => link(w.name, href(w.id), 'home-ws-item'))] : [];
      menu.replaceChildren(...group('Rooms', rooms, roomURL), ...group('Single stations (earlier workspaces)', stations, id => '/workspaces/' + encodeURIComponent(id)));
      if (!rooms.length && !stations.length) menu.replaceChildren(h('p', 'home-ws-note', 'No workspaces yet. Open the viewer to start one.'));
      loaded = true;
    } catch { menu.replaceChildren(h('p', 'home-ws-note', 'Workspaces could not be loaded. Try again later.')); }
  });
  document.addEventListener('pointerdown', e => { if (details.open && !details.contains(e.target as Node)) details.open = false; });
  details.addEventListener('keydown', e => { if (e.key === 'Escape') { details.open = false; details.querySelector('summary')?.focus(); } });
}

const story = document.getElementById('home-story'), picker = document.getElementById('home-workspaces');
if (story) carousel(story);
if (picker) workspaceMenu(picker);
export {};
