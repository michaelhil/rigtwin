// Serve one canonical room guide in two installations, each with its own advertised URLs.
function publicPaths(text:string) {
  return text.replace(/\/api\/|\/workspaces(?=[/{"\x20])/g, path => path === "/api/" ? "/api/room/" : "/workspaces/room");
}
export function publicRoomHtml(html:string) {
  return publicPaths(html).replace('<a href="/projects">Projects</a>', '');
}
export function publicRoomGuide(guide:string) {
  const publicGuide = guide.split("\n## Local projects")[0];
  return publicPaths(publicGuide) +
    "\n## Station workspaces\nOlder single-station workspaces keep their direct links. If no room matches the requested name, search GET /api/workspaces?search=<name>. A matched station opens at /workspaces/{id} and uses its own GET /api/commands catalogue and /api/workspaces/{id}/mcp endpoint. Read /wiki/80-reference/remote-commands.html for that interface. Private projects and customer rules run on the local installation.\n";
}
