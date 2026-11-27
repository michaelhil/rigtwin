// Machines exchange pinned project snapshots. Live scene IDs and undo histories stay local.
// The hierarchy is Workspace -> Project -> Scene.
import type { RoomCatalog, RoomScene } from "./room.ts";
export const PROJECT_FORMAT = "synergon-project/1" as const;
export const PROJECT_BODY_BYTES = 128 * 1024 * 1024;
export type ReleaseMode = "link" | "embed";
export type ReleaseFiles = Record<string, string>;
export interface ProjectTransfer {
  describe(pin: string): { redistributable: boolean };
  pack(pin: string): ReleaseFiles;
  /** Verify every byte and build an isolated resolver. commit publishes prepared entries without I/O. */
  prepare(entries: { pin: string; files: ReleaseFiles }[]): { catalog: RoomCatalog; commit(): void };
}
export interface NamedVersion {
  id: string;
  name: string;
  scene: RoomScene;
}
export interface ProjectSnapshot {
  id: string;
  name: string;
  markdown: string;
  scenes: RoomScene[];
  versions: NamedVersion[];
  assessment?: unknown;
}
export type ProjectDependency = { pin: string; mode: "link" } | { pin: string; mode: "embed"; files: ReleaseFiles };
export interface ProjectPackage {
  format: typeof PROJECT_FORMAT;
  project: ProjectSnapshot;
  dependencies: ProjectDependency[];
}
export interface ProjectSummary {
  id: string;
  name: string;
  folder: string;
  /** The workspace that holds the project. */
  workspace: string;
}
/** A scene in a project. `id` opens it at /workspaces/{id} and /api/scenes/{id}; `portable` is the ID that named
 *  versions and exported packages use, kept when a project moves to another installation. */
export interface ProjectScene { id: string; portable: string; name: string; revision: number }
export interface ProjectDetail extends ProjectSummary {
  markdown: string;
  scenes: ProjectScene[];
  versions: { id: string; scene: string; name: string; revision: number }[];
  dependencies: { pin: string; redistributable: boolean }[];
}

export interface WorkspaceSummary { id: string; name: string }
/** One read that feeds the Workspace -> Project -> Scene menus. */
export interface WorkspaceTree extends WorkspaceSummary {
  projects: { id: string; name: string; scenes: { id: string; name: string }[] }[];
}
/** Where a scene sits in the hierarchy. */
export interface SceneLocation { workspace: WorkspaceSummary; project: { id: string; name: string } }
