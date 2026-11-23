// bun test generator  — known-answer tests of the geometry kit.
import { test, expect } from "bun:test";
import { kit, assertMesh, type Mesh } from "./kit.ts";
import { evalExpr } from "./expr.ts";
import { jointMotion, composeTrs, invertTrs, poseFromRest, trsFromPose } from "../shared/pose.ts";

function volume(m: Mesh): number {
  let v = 0;
  const P = (i: number) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [P(m.indices[t]), P(m.indices[t + 1]), P(m.indices[t + 2])];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

test("closed primitives are outward (positive volume) and close to their analytic volume", () => {
  const cases: [string, Mesh, number, number][] = [
    ["box", kit.box(0.2, 0.3, 0.4), 0.024, 1e-9],
    ["bevelled box", kit.box(0.2, 0.3, 0.4, { bevel: 0.01 }), 0.024, 0.0005],
    ["cylinder", kit.cylinder(0.1, 0.5, { segments: 64 }), Math.PI * 0.01 * 0.5, 0.0002],
    ["extrude", kit.extrude(kit.rectOutline(1, 2), 0.1), 0.2, 1e-9],
    ["clockwise extrude", kit.extrude(kit.rectOutline(1, 2).reverse(), 0.1), 0.2, 1e-9],
    ["sphere", kit.sphere(0.1, { segments: 48 }), (4 / 3) * Math.PI * 0.001, 0.0001],
    ["tube path", kit.tubePath([[0, 0, 0], [0, 0, 1]], 0.05, { segments: 48 }), Math.PI * 0.0025, 0.0001],
    ["arc sweep", kit.sweepArc([[0, -0.1], [0.02, -0.1], [0.02, 0.1], [0, 0.1]], 1.8, 0.6, { segments: 48 }), 0.02 * 0.2 * 0.6 * 1.81, 0.0001],
  ];
  for (const [name, m, want, tol] of cases) { assertMesh(m, name); expect(Math.abs(volume(m) - want), name).toBeLessThan(tol); }
});

test("cage: mirrored, bevelled, with a concave face; rejects inconsistent winding", () => {
  const points = { a: [0, 0, 0], b: [1, 0, 0], c: [1, 0.5, 0], d: [0, 0.5, 0], e: [0, 0, 1], f: [1, 0, 1], g: [1, 0.5, 1], h: [0, 0.5, 1] };
  const half = [["a", "d", "c", "b"], ["e", "f", "g", "h"], ["b", "c", "g", "f"], ["d", "h", "g", "c"], ["a", "e", "h", "d"]];
  const m = kit.cage({ points, faces: half, mirror: true, bevel: 0.02 });
  assertMesh(m, "mirrored cage");
  expect(volume(m)).toBeGreaterThan(0.97);
  expect(volume(m)).toBeLessThan(1.0);
  expect(() => kit.cage({ points, faces: [...half.slice(0, 4), ["a", "d", "h", "e"]], mirror: true })).toThrow(/same direction/);
  const L = kit.prism([[0, 0, 1], [2, 0, 1], [2, 1, 1], [1, 1, 1], [1, 2, 1], [0, 2, 1]], [[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]], { bevel: 0.05 });
  assertMesh(L, "L prism");
  expect(Math.abs(volume(L) - 3)).toBeLessThan(0.06);
});

test("guards refuse NaN and degenerate input", () => {
  expect(() => kit.cylinder(0, 1)).toThrow();
  expect(() => kit.sweepArc([[0, 0], [1, 0], [1, 1]], 0, 1)).toThrow();
  expect(() => assertMesh({ positions: [0, 0, 0, 1, 0, 0, NaN, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }, "nan")).toThrow(/non-finite/);
  expect(() => assertMesh({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, -1, 0, 0, -1, 0, 0, -1], indices: [0, 1, 2] }, "flipped")).toThrow(/wound against/);
});

test("screen sheets: u = 0 on the operator's left (+Y), v = 0 at the top, facing -X", () => {
  for (const m of [kit.sheet(0.4, 0.2), kit.arcSheet(1.8, 1.2, 0.34)]) {
    assertMesh(m, "sheet");
    const i = m.uvs!.findIndex((u, k) => k % 2 === 0 && u === 0 && m.uvs![k + 1] === 0) / 2;
    expect(m.positions[i * 3 + 1]).toBeGreaterThan(0); expect(m.positions[i * 3 + 2]).toBeGreaterThan(0); expect(m.normals[i * 3]).toBeLessThan(0);
  }
});

test("expressions and the shared pose function", () => {
  const look = (k: string) => ({ "a.b": 2, "a.list": [[1, 2], [3, 4]] } as Record<string, unknown>)[k];
  expect(evalExpr("-a.b / 2 + a.list[1][0] * (1 + 1)", look)).toBe(5);
  expect(() => evalExpr("a.b +", look)).toThrow();
  const j = { type: "revolute" as const, axis: [0, 1, 0], lower: -1, upper: 1, neutral: 0.3 };
  const mount = trsFromPose([1, 2, 3], [0.1, 0.2, 0.3]), rest = composeTrs(mount, jointMotion(j, j.neutral));
  const a = poseFromRest(rest, j, 0.7), b = composeTrs(mount, jointMotion(j, 0.7));
  for (let i = 0; i < 3; i++) expect(Math.abs(a.t[i] - b.t[i])).toBeLessThan(1e-12);
  for (let i = 0; i < 4; i++) expect(Math.abs(a.q[i] - b.q[i])).toBeLessThan(1e-12);
  const id = composeTrs(mount, invertTrs(mount));
  expect(Math.hypot(...id.t)).toBeLessThan(1e-12);
});
