// The public room installation has its own namespace beside the earlier station workspaces.
export const PUBLIC_ROOM = /^\/workspaces\/room(?:\/|$)/.test(location.pathname) ||
  document.querySelector('link[rel="service-desc"]')?.getAttribute("href") === "/api/room/commands";
export const ROOM_API = PUBLIC_ROOM ? "/api/room" : "/api";
export const ROOM_DIRECTORY = PUBLIC_ROOM ? "/workspaces/room" : "/workspaces";
export const roomURL = (id:string) => ROOM_DIRECTORY + "/" + encodeURIComponent(id);
export const apiRoot = (id:string) => ROOM_API + "/workspaces/" + encodeURIComponent(id);
