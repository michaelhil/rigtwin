// The page's entry: which page is this address? Small, and it imports nothing of the 3D engine, so the landing is ready at once.
//
//   /                       the workspaces landing (landing.ts); on a server that has no workspaces (a static preview, `serve --no-api`)
//                           the viewer, as before
//   /workspaces/manage      Manage (manage.ts)
//   /workspaces/<id>        the viewer in that workspace: the engine, the rig and the person are fetched only here (main.ts, a
//                           separate chunk behind a dynamic import), after the server has said that the workspace exists
//
// Every address the page uses is absolute (/api/..., /version.json, /asset/...): a relative one breaks under /workspaces/<id>.
import { ID, current, getWorkspace, remember } from './workspace.ts';
import { landing, notThere } from './landing.ts';
import { manage } from './manage.ts';

const root = document.getElementById('app')!;

const viewerTemplate = document.getElementById('viewer-template') as HTMLTemplateElement;
/** Text pages can discard the unmounted viewer controls. */
function textPage() { viewerTemplate.remove(); }
async function viewer() {
  root.replaceWith(viewerTemplate.content);
  viewerTemplate.remove();
  document.documentElement.classList.remove('page');
  document.body.classList.remove('page');
  const { startViewer } = await import('./main.ts');
  await startViewer();
}
async function serverHasWorkspaces(): Promise<boolean> {
  try { return !!(await (await fetch('/version.json', { cache: 'no-store' })).json())?.server; } catch { return false; }
}
async function openWorkspace(id: string) {
  if (!ID.test(id)) { textPage(); notThere(root, 'unknown'); return; }
  const r = await getWorkspace(id);
  if (r.status === 404) { textPage(); notThere(root, 'unknown', id); return; }
  if (!r.ok || !r.data) { textPage(); notThere(root, 'offline', undefined, () => { location.reload(); }, r.status === 0 ? '' : r.message); return; }
  current.id = r.data.id; current.name = r.data.name;
  remember(r.data);
  await viewer();
}

const path = location.pathname.replace(/\/+$/, '');
if (path === '/workspaces/manage') { textPage(); manage(root); }
else if (path === '/workspaces') location.replace('/');
else if (path.startsWith('/workspaces/')) void openWorkspace(path.slice('/workspaces/'.length));
else void serverHasWorkspaces().then((has) => { if (has) { textPage(); landing(root); } else void viewer(); });
