// The workspace store: which workspaces exist and where each one's scene document lives.
//
//   <data>/workspaces.sqlite        the index: one row per workspace (id, name, created, changed). bun:sqlite is part of Bun.
//   <data>/workspaces/<id>/doc.json the scene document with its history (as <data>/playground/doc.json was before workspaces)
//   <data>/deleted/<id>/            a deleted workspace: the folder is moved here and its row removed. Nothing reads, serves
//                                   or removes it; the owner can bring it back by hand (wiki/50-implementation/workspaces.md).
//
// Every id is checked against ID_PATTERN before a disk path is built from it, and a name never becomes part of a path: the
// folder is named by the id only. Nothing in this file knows about HTTP; server/server.ts serves it.
import { Database } from "bun:sqlite";
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LIMITS } from "./limits.ts";

export interface Workspace { id: string; name: string; created: string; changed: string }

/** A random (version 4) UUID in lower case: 122 random bits, so a link cannot be guessed. The server answers 404 to anything else. */
export { ID_PATTERN, isWorkspaceId } from "./names.ts";
import { isWorkspaceId } from "./names.ts";
export const DEFAULT_NAME = "Untitled workspace";
/** The name of the workspace made on an empty data folder (and the one the local tools look for). */
export const PLAYGROUND = "Playground";

export { NameError, cleanName } from "./names.ts";
import { cleanName } from "./names.ts";

export const workspaceDir = (dataDir: string, id: string) => {
  if (!isWorkspaceId(id)) throw new Error("not a workspace id");     // never build a path from anything else
  return join(dataDir, "workspaces", id);
};
export const docPath = (dataDir: string, id: string) => join(workspaceDir(dataDir, id), "doc.json");

/** A file written whole: a temporary file, flushed, renamed over the old one. */
export function writeFileAtomic(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`, fd = openSync(tmp, "w", 0o600);
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, file);
}

const cursorOf = (n: number) => Buffer.from(String(n)).toString("base64url");
const cursorIn = (c: string | null | undefined): number | null => {
  if (!c) return null;
  const n = Number(Buffer.from(c, "base64url").toString());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

export interface Store {
  create(name?: unknown, doc?: unknown, at?: Date): Workspace;
  get(id: string): Workspace | null;
  /** the oldest workspace with exactly this name (the Playground, for the local tools) */
  byName(name: string): Workspace | null;
  list(o?: { search?: string; limit?: number; cursor?: string | null }): { workspaces: Workspace[]; next: string | null; total: number };
  count(): number;
  rename(id: string, name: string): Workspace | null;
  /** the last edit: written when the scene document is saved */
  touch(id: string, at?: Date): void;
  /** the folder moves to <data>/deleted/<id>/ and the row goes; false when there is no such workspace */
  remove(id: string): boolean;
  close(): void;
}

/** The index and the folders of a data folder (made when missing). */
export function openStore(dataDir: string): Store {
  mkdirSync(join(dataDir, "workspaces"), { recursive: true, mode: 0o700 });
  const file = join(dataDir, "workspaces.sqlite"), isNew = !existsSync(file);
  const db = new Database(file, { create: true });
  if (isNew) chmodSync(file, 0o600);                      // the index is the owner's, like everything in the data folder (-wal and -shm copy the mode)
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  // n counts creations (newest first = highest n); the id is the only name a folder gets
  db.run("CREATE TABLE IF NOT EXISTS workspaces (n INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created TEXT NOT NULL, changed TEXT NOT NULL)");
  const row = (r: any): Workspace => ({ id: r.id, name: r.name, created: r.created, changed: r.changed });
  const q = {
    insert: db.query("INSERT INTO workspaces (id, name, created, changed) VALUES (?1, ?2, ?3, ?3)"),
    get: db.query("SELECT id, name, created, changed FROM workspaces WHERE id = ?1"),
    byName: db.query("SELECT id, name, created, changed FROM workspaces WHERE name = ?1 ORDER BY n LIMIT 1"),
    count: db.query("SELECT COUNT(*) AS c FROM workspaces"),
    rename: db.query("UPDATE workspaces SET name = ?2, changed = ?3 WHERE id = ?1"),
    touch: db.query("UPDATE workspaces SET changed = ?2 WHERE id = ?1"),
    del: db.query("DELETE FROM workspaces WHERE id = ?1"),
    page: db.query("SELECT n, id, name, created, changed FROM workspaces WHERE (?1 IS NULL OR n < ?1) ORDER BY n DESC"),
  };
  const get = (id: string) => { if (!isWorkspaceId(id)) return null; const r = q.get.get(id) as any; return r ? row(r) : null; };
  return {
    create(name, doc, at = new Date()) {
      const w: Workspace = { id: randomUUID(), name: cleanName(name, DEFAULT_NAME), created: at.toISOString(), changed: at.toISOString() };
      const dir = workspaceDir(dataDir, w.id);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (doc !== undefined) writeFileAtomic(join(dir, "doc.json"), JSON.stringify(doc));
      q.insert.run(w.id, w.name, w.created);
      return w;
    },
    get,
    byName: (name) => { const r = q.byName.get(name) as any; return r ? row(r) : null; },
    count: () => (q.count.get() as any).c as number,
    list({ search = "", limit = LIMITS.workspaceListDefault, cursor = null } = {}) {
      const want = search.trim().toLowerCase().slice(0, LIMITS.workspaceNameChars), size = Math.min(LIMITS.workspaceListMax, Math.max(1, Math.floor(limit) || LIMITS.workspaceListDefault));
      const after = cursorIn(cursor), page: Workspace[] = [];
      let next: string | null = null, last = 0;
      // the name is matched here, not in SQL: SQLite lower-cases ASCII only, and names may be in any script
      for (const r of q.page.all(after) as any[]) {
        if (want && !String(r.name).toLowerCase().includes(want)) continue;
        if (page.length === size) { next = cursorOf(last); break; }
        page.push(row(r)); last = r.n;
      }
      const total = want ? (q.page.all(null) as any[]).filter((r) => String(r.name).toLowerCase().includes(want)).length : (q.count.get() as any).c;
      return { workspaces: page, next, total };
    },
    rename(id, name) {
      if (!get(id)) return null;
      q.rename.run(id, cleanName(name), new Date().toISOString());
      return get(id);
    },
    touch(id, at = new Date()) { if (isWorkspaceId(id)) q.touch.run(id, at.toISOString()); },
    remove(id) {
      if (!get(id)) return false;
      const from = workspaceDir(dataDir, id), root = join(dataDir, "deleted");
      mkdirSync(root, { recursive: true, mode: 0o700 });
      let to = join(root, id);
      if (existsSync(to)) to = `${to}.${Date.now()}`;         // never write over something already set aside
      if (existsSync(from)) renameSync(from, to);
      q.del.run(id);
      return true;
    },
    // everything is moved into the main file and the -wal file emptied, so a copy of workspaces.sqlite alone is whole
    close() { try { db.run("PRAGMA wal_checkpoint(TRUNCATE)"); } finally { db.close(); } },
  };
}

/** Make a workspace in a data folder, with a scene document when one is given (the cutover script places the converted
 *  Playground this way). The server need not be running; do not run it while the server is stopping. */
export function createWorkspace(dataDir: string, o: { name?: string; doc?: unknown } = {}): Workspace {
  const store = openStore(dataDir);
  try { return store.create(o.name, o.doc); } finally { store.close(); }
}
