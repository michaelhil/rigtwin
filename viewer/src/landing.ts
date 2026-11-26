// The landing (`/`) and the notice for a workspace that is not there. A small page, ready at once: it never loads the engine, the
// rig or the person. Words follow Leitbild's landing: Continue in ‹name›, New workspace, Recent in this browser, Browse workspaces.
import { h, link, ago, plural, focusFirst } from './dom.ts';
import { workspaceList } from './browse.ts';
import { CLOTHING, LICENCE } from './credits.ts';
import { addressOf, createWorkspace, cleanName, forget, getWorkspace, NAME_MAX, recent, remember, rename, type Recent, type Workspace } from './workspace.ts';

const NOTE = 'A workspace saves a shared scene. Anyone with its link can see it and change it.';

function shell(root: HTMLElement, title: string): HTMLElement {
  document.title = title === 'Synergon' ? 'Synergon' : `${title} · Synergon`;
  const main = h('main', 'pg');
  main.append(h('header', 'pg-head', h('h1', null, title)));
  root.textContent = ''; root.append(main);
  return main;
}
const row = (name: string, id: string, when: string) => { const a = link('', addressOf(id), 'wrow'); a.append(h('span', 'wrow-name', name), h('span', 'wrow-when', when)); return a; };

export function landing(root: HTMLElement) {
  document.title = 'Synergon';
  const intro = root.querySelector<HTMLElement>('.hero-text')!;
  const footer = root.querySelector('footer')!;
  const main = h('main', 'pg');
  root.textContent = ''; root.append(main);

  // The first screen: the name, what it is for, the one primary action, and a picture of the rig with the person in the seat.
  // The primary action always sits first: Continue in ‹name› when this browser has opened a workspace, else Create workspace.
  const cont = h('div', 'hero-primary');
  const nameInput = h('input'); nameInput.type = 'text'; nameInput.maxLength = NAME_MAX; nameInput.placeholder = 'Name (optional)'; nameInput.autocomplete = 'off'; nameInput.id = 'new-name'; nameInput.setAttribute('aria-label', 'Name of the new workspace (optional)');
  const create = h('button', 'primary', 'Create workspace'); create.type = 'submit';
  const err = h('p', 'form-err'); err.setAttribute('role', 'alert'); err.hidden = true;
  const form = h('form', 'pg-new');
  form.append(nameInput, create, err);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (create.disabled) return;
    create.disabled = true; create.textContent = 'Creating…'; err.hidden = true;
    const r = await createWorkspace(cleanName(nameInput.value));
    if (r.ok && r.data) { remember(r.data); location.assign(addressOf(r.data.id)); return; }
    create.disabled = false; create.textContent = 'Create workspace';
    err.textContent = r.status === 0 ? r.message : `No workspace was created. ${r.message}`; err.hidden = false;
  });
  const picture = h('img', 'hero-pic'); picture.src = '/landing-rig.webp'; picture.width = 960; picture.height = 720; picture.decoding = 'async';
  picture.alt = 'The operator’s station in 3D, with a person seated in it, seen from behind and to the right.';
  // the picture shows the dressed person, whose clothing is CC BY 4.0: credited wherever it is shown (credits.ts)
  const licence = h('a', null, CLOTHING[1]) as HTMLAnchorElement; licence.href = LICENCE; licence.target = '_blank'; licence.rel = 'noopener';
  const credit = h('figcaption', 'hero-credit'); credit.append(CLOTHING[0], licence, CLOTHING[2]);
  intro.append(cont, form, h('p', 'pg-note', NOTE));
  const hero = h('section', 'hero', intro,
    h('figure', 'hero-fig', h('div', 'hero-art', picture), credit));
  main.append(hero);

  // Recent in this browser
  const recentList = h('ul', 'pg-list'), recentEmpty = h('p', 'muted', 'Workspaces you open on this browser are listed here.');
  const recentCard = h('section', 'card', h('h2', null, 'Recent in this browser'), recentEmpty, recentList);
  const paintRecent = (list: Recent[]) => {
    recentList.textContent = ''; recentEmpty.hidden = list.length > 0;
    for (const r of list) recentList.append(h('li', null, row(r.name, r.id, `opened ${ago(r.opened)}`)));
    cont.textContent = '';
    hero.classList.toggle('has-recent', list.length > 0);
    create.classList.toggle('primary', list.length === 0);
    if (list[0]) cont.append(link(`Continue in ${list[0].name}`, addressOf(list[0].id), 'btn primary big'));
  };
  paintRecent(recent());
  // a workspace in the list may be gone, or have another name now: ask once for each, quietly
  void Promise.all(recent().map(async (r) => ({ r, a: await getWorkspace(r.id) }))).then((all) => {
    let changed = false;
    for (const { r, a } of all) {
      if (a.status === 404) { forget(r.id); changed = true; }
      else if (a.ok && a.data && a.data.name !== r.name) { rename(a.data); changed = true; }
    }
    if (changed) paintRecent(recent());
  });

  // Browse workspaces
  const count = h('span', 'muted');
  const all = workspaceList({
    limit: 10,
    row: (w: Workspace) => row(w.name, w.id, `created ${ago(w.created)}`),
    emptyText: 'There are no workspaces yet. Create the first one above.',
    onChange: (l) => { count.textContent = l.total() ? plural(l.total(), 'workspace') : ''; },
  });
  main.append(
    recentCard,
    h('section', 'card', h('div', 'card-head', h('h2', null, 'Browse workspaces'), count, link('Manage', '/workspaces/manage', 'card-link')), all.root),
    footer,
  );
}

/** A workspace address that leads nowhere: a deleted workspace or a mistyped link (it is dropped from Recent), or a server that
 *  did not answer (then nothing is dropped and the page offers to try again). */
export function notThere(root: HTMLElement, why: 'unknown' | 'offline', id?: string, retry?: () => void, detail = '') {
  if (why === 'unknown' && id) forget(id);
  const main = shell(root, why === 'offline' ? 'This workspace could not be opened' : 'This workspace is not here');
  const retryButton = why === 'offline' && retry ? h('button', 'primary', 'Try again') : null;
  if (retryButton) { retryButton.type = 'button'; retryButton.addEventListener('click', retry!); }
  main.append(h('section', 'card',
    h('p', null, why === 'offline'
      ? `${detail || 'The server did not answer.'} Check the connection and try again. Nothing is lost: a workspace is kept on the server.`
      : 'It was deleted, or the address is not right. A deleted workspace is gone for everyone who had its link.'),
    h('p', 'pg-actions', retryButton, link('Back to workspaces', '/', retryButton ? '' : 'btn primary'))));
  const first = main.querySelector('button.primary, a.primary') as HTMLElement | null; if (first) focusFirst(first);
}
