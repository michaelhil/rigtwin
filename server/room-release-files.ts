// Verify the files that the browser can request before a release enters an installation's library.
import { posix } from "node:path";

type Files = ReadonlyMap<string, Buffer>;
const imageFiles = /\.(?:png|jpe?g|ktx2|webp)$/i;
const passiveFiles = /\.(?:glb|bin|json|toml|md|png|jpe?g|ktx2|webp)$/i;
const imageTypes = new Set(["image/png", "image/jpeg", "image/ktx2", "image/webp"]);
const png = Buffer.from("89504e470d0a1a0a", "hex"),
  ktx2 = Buffer.from("ab4b5458203230bb0d0a1a0a", "hex");
function imageType(bytes: Buffer) {
  if (bytes.subarray(0, png.length).equals(png)) return "image/png";
  if (bytes.subarray(0, ktx2.length).equals(ktx2)) return "image/ktx2";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
}

function assetPath(files: Files, owner: string, ref: unknown, suffix: RegExp) {
  if (
    typeof ref !== "string" ||
    !ref.split("/").every((part) => part === "." || part === ".." || /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(part))
  )
    throw new Error(owner + " requires a relative file reference inside its pinned release.");
  const path = posix.join(posix.dirname(owner), ref);
  if (path.startsWith("../") || !suffix.test(path) || !files.has(path))
    throw new Error(owner + " requires " + ref + " in its pinned release inventory.");
  return path;
}

function verifyModel(files: Files, path: string, bytes: Buffer) {
  const invalid = () => new Error("Invalid GLB container in " + path);
  if (
    bytes.length < 20 ||
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length ||
    bytes.readUInt32LE(16) !== 0x4e4f534a
  )
    throw invalid();
  const end = 20 + bytes.readUInt32LE(12);
  if (end % 4 || end > bytes.length) throw invalid();
  if (
    end !== bytes.length &&
    (end + 8 > bytes.length ||
      bytes.readUInt32LE(end + 4) !== 0x004e4942 ||
      end + 8 + bytes.readUInt32LE(end) !== bytes.length)
  )
    throw invalid();
  const gltf = JSON.parse(bytes.toString("utf8", 20, end));
  const buffers: (Buffer | undefined)[] = (gltf.buffers ?? []).map(
    (b: { uri?: string; extensions?: { EXT_meshopt_compression?: { fallback?: boolean } } }, i: number) => {
      if (b.uri !== undefined) return files.get(assetPath(files, path, b.uri, /\.bin$/i))!;
      // meshopt generates this logical buffer locally from its pinned compressed views.
      if (b.extensions?.EXT_meshopt_compression?.fallback === true) return undefined;
      if (i !== 0 || end === bytes.length) throw invalid();
      return bytes.subarray(end + 8);
    },
  );
  for (const image of gltf.images ?? []) {
    if (image.mimeType !== undefined && !imageTypes.has(image.mimeType))
      throw new Error("Unsupported image type in " + path);
    if (image.uri !== undefined) {
      if (image.bufferView !== undefined) throw invalid();
      const file = files.get(assetPath(files, path, image.uri, imageFiles))!;
      if (image.mimeType && imageType(file) !== image.mimeType) throw new Error("Image type mismatch in " + path);
      continue;
    }
    const view = gltf.bufferViews?.[image.bufferView],
      buffer = buffers[view?.buffer];
    const offset = view?.byteOffset ?? 0,
      length = view?.byteLength;
    if (
      !buffer ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length <= 0 ||
      offset + length > buffer.length ||
      !image.mimeType ||
      imageType(buffer.subarray(offset, offset + length)) !== image.mimeType
    )
      throw new Error("Invalid embedded image for " + path);
  }
}

function verifyAvatar(files: Files, path: string, avatar: any) {
  const check = (ref: unknown, suffix: RegExp) => assetPath(files, path, ref, suffix);
  const materialMaps = (materials: Record<string, any>) => {
    for (const m of Object.values(materials)) {
      for (const ref of [m.detailNormal, m.clearcoatMap, m.poseNormal?.posed]) if (ref != null) check(ref, imageFiles);
    }
  };
  check(avatar.glb, /\.glb$/i);
  if (avatar.posesFile != null) check(avatar.posesFile, /\.json$/i);
  for (const bake of [avatar.shape?.bake ?? []].flat()) check(bake.file, /\.bin$/i);
  for (const clip of avatar.clips ?? []) {
    if (clip.source && clip.source !== "glb") check(clip.source, /\.glb$/i);
    for (const ref of Object.values(clip.perBody ?? {})) check(ref, /\.glb$/i);
  }
  materialMaps(avatar.materials ?? {});
  for (const tone of avatar.tones?.list ?? []) {
    for (const ref of Object.values(tone.textures ?? {})) check(ref, imageFiles);
    materialMaps(tone.materials ?? {});
  }
  for (const slot of avatar.wardrobe?.slots ?? [])
    for (const g of slot.garments) {
      if (g.source != null) check(g.source, /\.glb$/i);
      for (const ref of [g.bodyMask, g.cover]) if (ref != null) check(ref, imageFiles);
    }
  for (const ref of avatar.packet?.otherPackages ?? []) check(ref, /\.avatar\.json$/i);
  // Licence and provenance records describe the source. The viewer does not fetch them.
}

export function verifyReleaseFiles(files: Files) {
  for (const [path, bytes] of files) {
    if (!passiveFiles.test(path)) throw new Error("Unsupported release file type: " + path);
    if (
      imageFiles.test(path) &&
      imageType(bytes) !== "image/" + posix.extname(path).slice(1).toLowerCase().replace(/^jpg$/, "jpeg")
    )
      throw new Error("Invalid image bytes in " + path);
    if (/\.glb$/i.test(path)) verifyModel(files, path, bytes);
    if (/\.avatar\.json$/i.test(path)) verifyAvatar(files, path, JSON.parse(bytes.toString("utf8")));
  }
}
