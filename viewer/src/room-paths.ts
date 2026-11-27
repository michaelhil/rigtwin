// One address scheme on both installations: the API under /api, a scene's page at /workspaces/{sceneId}.
export const API = "/api";
export const sceneURL = (id:string) => "/workspaces/" + encodeURIComponent(id);
export const apiRoot = (id:string) => API + "/scenes/" + encodeURIComponent(id);
/** True on the public site once publicSite() has answered (GET /api/health reports public: true there). */
export let PUBLIC_ROOM = false;
let probe: Promise<boolean> | undefined;
export function publicSite(): Promise<boolean> {
  return probe ??= fetch(API + "/health", { cache: "no-store" }).then(r => r.json())
    .then((j: { public?: boolean }) => (PUBLIC_ROOM = j?.public === true)).catch(() => false);
}
