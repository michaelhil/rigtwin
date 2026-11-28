// Live content on a scene's flat screens: which page or app view each screen shows (`scene.content`, beside
// `lighting`). This release only reads the block: it keeps it, undoes it, transfers and compares it; no command
// writes it yet. Lenient scene, strict commands: a malformed block only makes its screens wait.

/** The feature's constants, in one place for the server (the viewer's own are at the top of its frame layer). */
export const LIVE = {
  maxSources: 16, maxShows: 64, maxUrl: 2048, keyLength: 10, nameLength: 26,
  layoutWidth: 1280,              // CSS px of every frame's layout, at the screen's aspect
  maxFrames: 12, readyTimeoutMs: 30_000, loadTimeoutMs: 20_000, hiddenTabMs: 120_000,
  seenEveryMs: 1_000, seenTtlMs: 60_000, facingUpLimit: 0.7, areaClass: 0.8, flatDepth: 0.002,
  maxContentBytes: 64 * 1024,     // JSON of one scene's content block
} as const;

export interface SceneContent {
  sources: Record<string, ContentSource>;                 // id ^[a-z0-9][a-z0-9-]{0,31}$
  shows: Record<string, Record<string, Show>>;            // instance id → S_ member id → show
}
export type ContentSource = AppSource | PageSource;
export interface AppSource  { kind: "app";  app: string; item: string; label: string; run: { key: string } }   // key ^[a-z2-7]{10}$
export interface PageSource { kind: "page"; url: string; label: string }                                     // url passed frameAddress
export interface Show { source: string; view?: string }  // view ^[A-Za-z0-9._:-]{1,64}$, required iff the source is an app source

export interface LiveApps { format: "live-surfaces/1"; apps: LiveApp[]; publicSites: string[] }
export interface LiveApp  { id: string; label: string; origin: string; list?: string; items: LiveItem[] }
export interface LiveItem { id: string; label: string; page: string; views: { id: string; label: string }[] }

export type SeenState = "starting" | "showing" | "waiting" | "ended" | "refused" | "not_answering"
  | "awaiting_click" | "not_allowed" | "off";
export interface SeenReport { state: SeenState; run?: string; view?: string }   // run ^[A-Za-z0-9_-]{1,64}$

export interface SurfaceInfo {                            // from RoomCatalog.surfaces(instance)
  screen: string; label: string; size: [number, number];  // metres, width × height of the sheet
  flat: boolean; facing: [number, number, number];        // room frame unit normal (east, north, up)
  centre: [number, number, number];                       // asset frame, posed
}

export interface AddressPolicy { mode: "public" | "local"; self: string; apps: LiveApp[]; publicSites: string[]; typed?: boolean; app?: LiveApp }
export interface ContentContext { apps: LiveApps; mode: "public" | "local"; self: string }

const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** Lenient: is this a content block worth keeping? Never throws. Unknown keys and kinds are kept as they are. */
export function contentShapeOk(x: unknown): boolean {
  if (!plain(x) || !plain(x.sources) || !plain(x.shows)) return false;
  try {
    const json = JSON.stringify(x);
    return typeof json === "string" && new TextEncoder().encode(json).length <= LIVE.maxContentBytes;
  } catch { return false; }   // a cycle or a BigInt: not a stored block
}
