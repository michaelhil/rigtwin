// The installed proxy serves index.html for every workspace URL. Preserve bookmarked station
// URLs (and their query and hash) while the homepage and /workspaces/room/ open the room editor.
const station = /^\/workspaces\/(?!room(?:\/|$))[^/]/.test(location.pathname);
if (station) {
  const response = await fetch('/station.html');
  if (!response.ok) throw new Error('The station viewer could not be loaded.');
  const html = new DOMParser().parseFromString(await response.text(), 'text/html');
  html.querySelectorAll('script').forEach(script => script.remove());
  document.documentElement.className = html.documentElement.className;
  document.head.replaceChildren(...html.head.children);
  document.body.replaceWith(html.body);
  await import('/app.js');
} else if (location.pathname.startsWith('/workspaces')) {
  for (const href of ['/room.css', '/room-view.css']) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = href; document.head.append(link);
  }
  const { startRoomApp } = await import('/room-entry.js');
  await startRoomApp();
}
if (location.pathname === '/') await import('/home.js');
