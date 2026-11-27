// Validate the whole archive before opening its destination folder or publishing files to the library.
import { isDeepStrictEqual } from "node:util";
import {
  PROJECT_FORMAT,
  type NamedVersion,
  type ProjectDependency,
  type ProjectPackage,
  type ProjectSnapshot,
  type ReleaseFiles,
  type ReleaseMode,
} from "../shared/project.ts";
import { ROOM_SCHEMA, type RoomCatalog, type RoomScene } from "../shared/room.ts";
import { validateInstance, parseRoom } from "./room-model.ts";
import { cleanName, isWorkspaceId } from "./names.ts";

export class ProjectError extends Error {
  constructor(
    public code: string,
    message: string,
    public hint = "Check the project command arguments and retry.",
    public status = 422,
  ) {
    super(message);
  }
}
export const invalid = (message: string) =>
  new ProjectError("invalid_project", message, "Correct the listed item and retry with a complete project package.");
export const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
export function fields(x: unknown, allowed: string[], required = allowed): asserts x is Record<string, unknown> {
  if (!object(x) || Object.keys(x).some((k) => !allowed.includes(k)) || required.some((k) => !Object.hasOwn(x, k)))
    throw invalid("Expected fields " + allowed.join(", ") + ".");
}
export function id(value: unknown) {
  if (!isWorkspaceId(value)) throw invalid("Expected a version-4 UUID.");
  return value;
}
export function name(value: unknown) {
  const n = cleanName(value);
  if (n !== value) throw invalid("Use a trimmed, visible name.");
  return n;
}
export function markdown(value: unknown) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 1024 * 1024 || value.includes("\0"))
    throw invalid("project.md must be Markdown text of at most 1 MiB.");
  return value;
}
const pinPattern = /^[a-z0-9][a-z0-9_.-]{0,79}@[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}#[a-f0-9]{64}$/;
function pin(value: unknown) {
  if (typeof value !== "string" || !pinPattern.test(value))
    throw invalid("Invalid exact release ID: " + String(value).slice(0, 180));
  return value;
}
function unique<T>(xs: T[], key: (x: T) => string, what: string) {
  if (new Set(xs.map(key)).size !== xs.length) throw invalid("Duplicate " + what + ".");
}
function array(value: unknown, max: number, desc: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw invalid("Expected at most " + max + " " + desc + ".");
  return value;
}
export function sceneShape(x: unknown): RoomScene {
  fields(x, ["schema", "id", "name", "version", "room", "instances", "person"]);
  if (x.schema !== ROOM_SCHEMA) throw invalid("Unsupported scene format.");
  id(x.id);
  name(x.name);
  if (!Number.isSafeInteger(x.version) || (x.version as number) < 0) throw invalid("Invalid source scene revision.");
  fields(x.room, ["width", "height", "depth", "door", "window"]);
  fields(x.room.door, ["width", "offset"]);
  fields(x.room.window, ["width", "offset"]);
  for (const i of array(x.instances, 10000, "instances")) {
    fields(i, ["id", "label", "release", "x", "y", "yaw", "pose"]);
    if (typeof i.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(i.id))
      throw invalid("Invalid scene-local instance ID.");
    name(i.label);
    pin(i.release);
  }
  if (x.person !== null) {
    fields(x.person, ["host", "state"]);
    const s = x.person.state;
    fields(
      s,
      ["style", "sex", "tone", "glasses", "headset", "preset", "body", "posture", "aims"],
      ["style", "sex", "tone", "glasses", "headset", "preset", "body", "posture"],
    );
    if (
      !["clay", "dressed"].includes(String(s.style)) ||
      !["male", "female"].includes(String(s.sex)) ||
      typeof s.glasses !== "boolean" ||
      typeof s.headset !== "boolean" ||
      typeof s.tone !== "string" ||
      typeof s.posture !== "string" ||
      !(s.preset === null || typeof s.preset === "string") ||
      !object(s.body) ||
      Object.values(s.body).some((v) => !Number.isFinite(v))
    )
      throw invalid("Invalid operator configuration.");
    if (s.aims !== undefined) {
      fields(s.aims, ["look", "left_hand", "right_hand", "left_foot", "right_foot"], []);
      for (const [key, aim] of Object.entries(s.aims)) {
        if (key === "look") {
          if (typeof aim !== "string") throw invalid("Invalid gaze target.");
          continue;
        }
        const hand = key.endsWith("hand");
        if (!object(aim)) throw invalid("Invalid operator aim.");
        if (aim.mode === (hand ? "rest" : "floor")) fields(aim, ["mode"]);
        else {
          fields(aim, ["mode", "target"]);
          if (!(hand ? ["point", "touch"] : ["on"]).includes(String(aim.mode)) || typeof aim.target !== "string")
            throw invalid("Invalid operator limb target.");
        }
      }
    }
  }
  // parseRoom checks dimensional bounds, finite transforms, poses, occupancy and unique instance IDs.
  parseRoom(JSON.stringify({ scene: { ...x, version: 0 }, history: [] }));
  return x as unknown as RoomScene;
}
function snapshot(x: unknown): ProjectSnapshot {
  fields(
    x,
    ["id", "name", "markdown", "scenes", "versions", "assessment"],
    ["id", "name", "markdown", "scenes", "versions"],
  );
  id(x.id);
  name(x.name);
  markdown(x.markdown);
  const scenes = array(x.scenes, 1000, "scenes").map(sceneShape);
  if (!scenes.length) throw invalid("A project must contain a scene.");
  unique(scenes, (s) => s.id, "scene ID");
  const sceneIds = new Set(scenes.map((s) => s.id));
  const versions = array(x.versions, 10000, "versions").map((v) => {
    fields(v, ["id", "name", "scene"]);
    id(v.id);
    name(v.name);
    if (!sceneIds.has(sceneShape(v.scene).id)) throw invalid("A named version references an unknown scene.");
    return v as unknown as NamedVersion;
  });
  unique(versions, (v) => v.id, "named version ID");
  return x as unknown as ProjectSnapshot;
}
export function projectPins(p: ProjectSnapshot, assessmentPins: string[]) {
  return [
    ...new Set(
      [...p.scenes, ...p.versions.map((v) => v.scene)]
        .flatMap((s) => s.instances.map((i) => i.release))
        .concat(assessmentPins),
    ),
  ].sort();
}
export function makePackage(
  p: ProjectSnapshot,
  assessmentPins: string[],
  catalog: RoomCatalog,
  mode: ReleaseMode,
  modes: Record<string, ReleaseMode>,
): ProjectPackage {
  const pins = projectPins(p, assessmentPins);
  if (
    !["embed", "link"].includes(mode) ||
    !object(modes) ||
    Object.entries(modes).some(([k, v]) => !pins.includes(k) || !["embed", "link"].includes(v))
  )
    throw invalid("Specify embed or link for project release pins only.");
  const dependencies = pins.map((pin): ProjectDependency => {
    if (!catalog.releases.some((r) => r.id === pin)) throw unavailable(pin);
    const allowed = catalog.transfer?.describe(pin).redistributable === true;
    const choice = modes[pin] ?? (allowed ? mode : "link");
    if (choice === "link") return { pin, mode: "link" };
    if (!allowed) throw restricted(pin);
    return { pin, mode: "embed", files: catalog.transfer!.pack(pin) };
  });
  return { format: PROJECT_FORMAT, project: p, dependencies };
}
const unavailable = (pin: string) =>
  new ProjectError(
    "missing_release",
    "Missing exact release " + pin + ".",
    "Install this pin from an approved library or request an embedded transfer.",
  );
const restricted = (pin: string) =>
  new ProjectError(
    "restricted_release",
    "Embedding is restricted for " + pin + ".",
    "Link this pin and supply its authorized copy on the receiving installation.",
  );
export function inspectPackage(raw: unknown) {
  fields(raw, ["format", "project", "dependencies"]);
  if (raw.format !== PROJECT_FORMAT)
    throw new ProjectError(
      "unsupported_format",
      "Expected " + PROJECT_FORMAT + ".",
      "Export with a compatible project format.",
    );
  const project = snapshot(raw.project);
  const dependencies = array(raw.dependencies, 1000, "dependencies").map((d): ProjectDependency => {
    if (!object(d)) throw invalid("Malformed dependency record.");
    const key = pin(d.pin);
    if (d.mode === "link") {
      fields(d, ["mode", "pin"]);
      return { pin: key, mode: "link" };
    }
    fields(d, ["mode", "pin", "files"]);
    if (
      d.mode !== "embed" ||
      !object(d.files) ||
      !Object.keys(d.files).length ||
      Object.entries(d.files).some(
        ([key, v]) =>
          !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(key) ||
          key.split("/").some((s) => s.startsWith(".")) ||
          typeof v !== "string",
      )
    )
      throw invalid("Invalid embedded file list for " + key + ".");
    return { pin: key, mode: "embed", files: d.files as ReleaseFiles };
  });
  unique(dependencies, (d) => d.pin, "release declaration");
  return { project, dependencies };
}
export function resolvePackage(
  project: ProjectSnapshot,
  dependencies: ProjectDependency[],
  assessmentPins: string[],
  catalog: RoomCatalog,
) {
  const required = projectPins(project, assessmentPins);
  const declared = dependencies.map((d) => d.pin).sort();
  if (!isDeepStrictEqual(required, declared))
    throw invalid(
      "Dependencies must match the scenes, versions and assessments. Missing: " +
        required.filter((p) => !declared.includes(p)).join(", ") +
        ". Extra: " +
        declared.filter((p) => !required.includes(p)).join(", "),
    );
  for (const d of dependencies) {
    if (d.mode === "link" && !catalog.releases.some((r) => r.id === d.pin)) throw unavailable(d.pin);
    if (
      d.mode === "embed" &&
      catalog.releases.some((r) => r.id === d.pin) &&
      !catalog.transfer?.describe(d.pin).redistributable
    )
      throw restricted(d.pin);
  }
  const entries = dependencies.filter((d) => d.mode === "embed");
  if (entries.length && !catalog.transfer)
    throw new ProjectError(
      "missing_resolver",
      "No embedded release resolver is available.",
      "Use an installation supporting embedded room releases.",
    );
  try {
    const prepared = entries.length ? catalog.transfer!.prepare(entries) : { catalog, commit() {} };
    for (const scene of [...project.scenes, ...project.versions.map((v) => v.scene)]) {
      for (const item of scene.instances) validateInstance(scene, prepared.catalog, item);
      if (scene.person) {
        const host = scene.instances.find((i) => i.id === scene.person!.host)!;
        if (!prepared.catalog.eye || !prepared.catalog.eye(host, scene.person.state).every(Number.isFinite))
          throw invalid("The saved operator must resolve to a finite seated eye.");
      }
    }
    return prepared;
  } catch (e) {
    if (e instanceof ProjectError) throw e;
    throw new ProjectError(
      "invalid_dependency",
      e instanceof Error ? e.message : String(e),
      "Verify pinned file digests, redistribution permission, operator state and pose limits, then export again.",
    );
  }
}
