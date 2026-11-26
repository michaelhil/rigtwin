// Machines exchange pinned project snapshots. Workspace handles and undo histories stay local.
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
}
export interface ProjectDetail extends ProjectSummary {
  markdown: string;
  scenes: { id: string; workspace: string; name: string; revision: number }[];
  versions: { id: string; scene: string; name: string; revision: number }[];
  dependencies: { pin: string; redistributable: boolean }[];
}
