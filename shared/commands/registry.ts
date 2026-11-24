// The command registry: one list of commands, each with an id, a one-line summary, a kind, an
// argument schema and examples. The server validates every command against it (view commands too) and
// serves the list as `GET api/commands`; `bun run rig list` prints it. core.ts registers the commands.
//
// Kinds: "query" reads, "edit" changes the scene document (and is recorded in its history), "view"
// is carried out by one browser, the one whose session code the command names.
import type { Manifest, ManifestJoint } from "../manifest.ts";
import type { KNode } from "../kinematics.ts";
import { check, type Schema, type CommandError } from "./schema.ts";
import type { Actor, JointChange, SceneDoc } from "./doc.ts";

/** The open asset as the commands see it: its description file and its node tree (from the GLB). */
export interface AssetInfo { name: string; sha256: string; manifest: Manifest; nodes: KNode[]; joints: Map<string, ManifestJoint> }

export interface RunOutput<R> {
  result: R;
  /** edits: the changes to record (`before` = current value) */
  changes?: JointChange[];
  /** edits: every joint the command names (for the stale check); defaults to the joints of `changes` */
  joints?: string[];
  /** edits: the versions this edit reverts */
  undoes?: number[];
}

export interface CommandSpec<A = any, R = any> {
  id: string;
  summary: string;
  kind: "query" | "edit" | "view";
  args: Schema;
  examples: { args: A; note: string }[];
  run?(ctx: { doc: SceneDoc; asset: AssetInfo; actor: Actor }, args: A): RunOutput<R>;
}

const specs = new Map<string, CommandSpec>();

export function register(spec: CommandSpec) {
  if (specs.has(spec.id)) throw new Error(`command '${spec.id}' is registered twice`);
  specs.set(spec.id, spec);
}
export const get = (id: string) => specs.get(id);

/** The catalogue: every command without its code, in registration order. */
export function list() {
  return [...specs.values()].map(({ id, summary, kind, args, examples }) => ({ id, summary, kind, args, examples }));
}

/** The command and its checked arguments, or the error to send back. */
export function validate(id: unknown, args: unknown): { spec: CommandSpec; args: any } | { error: CommandError } {
  const spec = typeof id === "string" ? specs.get(id) : undefined;
  if (!spec) {
    const near = typeof id === "string" ? [...specs.keys()].filter((k) => k.split(".")[0] === id.split(".")[0] || k.includes(id)) : [];
    return { error: { code: "unknown_command", message: `there is no command ${JSON.stringify(id)}`, hint: `${near.length ? `did you mean ${near.join(", ")}? ` : ""}\`bun run rig list\` (GET api/commands) lists every command` } };
  }
  const a = args === undefined ? {} : args, problem = check(spec.args, a);
  if (problem) return { error: { code: "invalid_args", message: `${spec.id}: ${problem}`, hint: `the arguments of ${spec.id} are described by the schema below; examples: ${spec.examples.map((e) => JSON.stringify(e.args)).join("  ")}`, schema: spec.args } };
  return { spec, args: a };
}
