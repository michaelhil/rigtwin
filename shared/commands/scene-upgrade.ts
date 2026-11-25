// One-off conversion of a stored scene document of an earlier format to the current one (SCENE_FORMAT). The server does
// not read earlier formats; a cutover script calls upgradeDoc() once per stored document and writes the result back.
// Pure: no files. The earlier format ids are given by the caller, so this module names none of them.
import { SCENE_FORMAT, parseDoc, type PersonState, type SceneDoc } from "./doc.ts";

/** `raw` must carry one of the `from` schema ids. Pose, version and history stay as they are; the schema becomes
 *  SCENE_FORMAT; a document without a person gets `person` (null: nobody). The input is not changed. The result is
 *  checked with parseDoc(), which throws with a reason when the document is malformed. */
export function upgradeDoc(raw: unknown, opts: { from: string[]; person?: PersonState | null }): SceneDoc {
  const d = raw as { schema?: unknown; person?: unknown } | null;
  if (!d || typeof d.schema !== "string" || !opts.from.includes(d.schema)) throw new Error(`not a document of an earlier format (${opts.from.join(", ")})`);
  const copy = structuredClone(d) as any;
  copy.schema = SCENE_FORMAT;
  if (copy.person === undefined) copy.person = opts.person ? structuredClone(opts.person) : null;
  return parseDoc(copy);
}
