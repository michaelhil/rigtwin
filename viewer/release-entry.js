// The installed proxy serves index.html for every /workspaces/ address. A scene page (and a project page, where a
// server serves one) opens the room editor; the homepage loads its own small script.
// The page loads this file as /release-entry.js?v=<release>; the same tag goes on every script and
// stylesheet it loads, so a browser never runs a mix of an old and a new release.
const v = new URL(import.meta.url).search;
if (/^\/(?:workspaces|projects)(?:\/|$)/.test(location.pathname)) {
  for (const href of ['/room.css', '/room-view.css']) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = href + v; document.head.append(link);
  }
  const { startRoomApp } = await import('/room-entry.js' + v);
  await startRoomApp();
}
if (location.pathname === '/') await import('/home.js' + v);
