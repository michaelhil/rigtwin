import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { verifyReleaseFiles } from "./room-release-files.ts";

function model(json: object) {
  const chunk = Buffer.from(JSON.stringify(json));
  const length = Math.ceil(chunk.length / 4) * 4;
  const data = Buffer.alloc(20 + length, 0x20);
  data.write("glTF");
  data.writeUInt32LE(2, 4);
  data.writeUInt32LE(data.length, 8);
  data.writeUInt32LE(length, 12);
  data.write("JSON", 16);
  chunk.copy(data, 20);
  return data;
}

test("browser dependencies resolve within the release, including shared avatar files and clips", () => {
  const avatar = "manikin/operator-m/operator-m.avatar.json";
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aigAAAABJRU5ErkJggg==",
    "base64",
  );
  const packageData = {
    glb: "operator.glb",
    clips: [{ source: "../clips/sitting.glb" }],
    materials: { cloth: { detailNormal: "../shared/texture.png" } },
    licence: [{ url: "https://example.invalid/licence" }],
  };
  const files = new Map([
    ["model.glb", model({ buffers: [{ uri: "model.bin" }], images: [{ uri: "manikin/shared/texture.png" }] })],
    ["model.bin", Buffer.alloc(4)],
    ["manikin/shared/texture.png", png],
    [avatar, Buffer.from(JSON.stringify(packageData))],
    ["manikin/operator-m/operator.glb", model({})],
    ["manikin/clips/sitting.glb", model({})],
  ]);
  expect(() => verifyReleaseFiles(files)).not.toThrow();
  for (const [name, content] of [
    ["model.glb", model({ buffers: [{ uri: "https://example.invalid/model.bin" }] })],
    ["model.glb", model({ images: [{ uri: "../texture.png" }] })],
    [
      avatar,
      Buffer.from(JSON.stringify({ ...packageData, tones: { list: [{ textures: { colour: "missing.png" } }] } })),
    ],
    [
      avatar,
      Buffer.from(
        JSON.stringify({ ...packageData, clips: [{ perBody: { sample: "https://example.invalid/sitting.glb" } }] }),
      ),
    ],
    ["notes.html", Buffer.from("Notes")],
    ["manikin/shared/texture.png", Buffer.from("Unrecognized image data")],
  ] as const) {
    expect(() => verifyReleaseFiles(new Map(files).set(name, content))).toThrow();
  }
});

test("the shipped seated-operator motion library resolves its meshopt fallback buffer offline", () => {
  const file = "manikin/clips/f/F50_HEAVY/idle-stand.glb";
  const data = readFileSync(new URL("../assets/" + file, import.meta.url));
  expect(() => verifyReleaseFiles(new Map([[file, data]]))).not.toThrow();
});
