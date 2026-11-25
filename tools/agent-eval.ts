// bun tools/agent-eval.ts [--variant v2|baseline|both] [--cases id,id] [--model sonnet] [--runs 1] [--out file.json]
//                          [--baseline-dir <checkout of the step-1 interface>]
// The agent benchmark (agent interface v2): owner requests from tools/agent-eval/cases.json, each given to a fresh headless
// Claude Code (`claude -p`) against a temporary local scene with one viewer page open in headless Chromium. Scored from
// the scene itself, not from what the agent says: the final pose (every joint), the page's view, whether it asked when it
// had to, and words its answer must contain; plus tool calls, turns, wall time and cost from Claude Code's own report.
//
//   v2        only the five MCP tools of the server (--strict-mcp-config, no built-in tools)
//   baseline  the step-1 interface: the shell command line `bun run rig` and the Skill v0, run in a checkout of commit
//             8898e66 (--baseline-dir; made with `git worktree add --detach <dir> 8898e66` and `bun install`)
//
// It spends tokens (one Claude Code run per case and variant), so it runs on demand, not in `bun run check`. Claude Code is
// `claude` on the PATH, $CLAUDE_BIN, or the copy the desktop app bundles.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawn } from "bun";
import { ROOT } from "./timeline.ts";
import { startServer } from "./serve.ts";
import { Browser, type Page } from "./render.ts";
import { call } from "./rig.ts";

const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const variants = (opt("--variant") ?? "both") === "both" ? ["baseline", "v2"] : [opt("--variant")!];
const model = opt("--model") ?? "sonnet", runs = Number(opt("--runs") ?? 1);
const baselineDir = opt("--baseline-dir") ?? join(tmpdir(), "synergon-baseline");
const only = opt("--cases")?.split(",");
type Case = { id: string; prompt: string; preset?: Record<string, number>; expect: { pose?: Record<string, number>; view?: string; asks?: boolean; says?: string[]; person?: Record<string, unknown> | null } };
const cases: Case[] = JSON.parse(readFileSync(join(ROOT, "tools", "agent-eval", "cases.json"), "utf8")).cases.filter((c: Case) => !only || only.includes(c.id));

function claudeBin(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const onPath = Bun.which("claude");
  if (onPath) return onPath;
  const root = join(homedir(), "Library", "Application Support", "Claude", "claude-code");
  const versions = existsSync(root) ? readdirSync(root).filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : [];
  for (const v of versions.reverse()) for (const h of readdirSync(join(root, v))) { const p = join(root, v, h, "claude.app", "Contents", "MacOS", "claude"); if (existsSync(p)) return p; }
  throw new Error("Claude Code not found: put claude on the PATH or set CLAUDE_BIN");
}
const CLAUDE = claudeBin();
if (variants.includes("baseline") && !existsSync(join(baselineDir, "tools", "rig.ts"))) throw new Error(`no baseline checkout at ${baselineDir}: git worktree add --detach ${baselineDir} 8898e66 && (cd ${baselineDir} && bun install && bun run build)`);

const DEG = Math.PI / 180;
const data = mkdtempSync(join(tmpdir(), "synergon-agent-eval-"));
const server = await startServer({ port: 0, data });
const browser = await Browser.launch();
const page: Page = await browser.page("about:blank");
await page.viewport(1280, 800);
const WS = server.api!.playground()!.id;           // the Playground of the empty data folder; its page is /workspaces/<id>
process.env.RIG_WORKSPACE = WS;
await page.call("Page.navigate", { url: `${server.url}/workspaces/${WS}` });
await page.waitFor("window.viewerReady || window.viewerError", "the viewer");
for (let i = 0; i < 100 && !(await page.evaluate("!!(viewer.live && viewer.live() && viewer.live().connected)").catch(() => false)); i++) await Bun.sleep(50);
const code = (await page.evaluate("viewer.live().code")) as string;
const manifest = JSON.parse(readFileSync(join(ROOT, "assets", "rig-b", "build", "rig-b.manifest.json"), "utf8"));
const joints = new Map<string, any>(manifest.joints.map((j: any) => [j.id, j]));
/** a joint's value in pose.set units (metres, degrees) from the scene's SI pose */
const units = (id: string, v: number) => (joints.get(id).type === "prismatic" ? v : v / DEG);

const mcpConfig = join(data, "mcp.json");
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { synergon: { type: "http", url: `${server.url}/api/workspaces/${WS}/mcp` } } }));
const emptyMcp = join(data, "mcp-empty.json");
writeFileSync(emptyMcp, JSON.stringify({ mcpServers: {} }));

async function runCase(c: Case, variant: string) {
  server.reset();
  await page.evaluate("viewer.apply({})");
  if (c.preset) await call("pose.set", { joints: c.preset, allowAssumed: true }, { server: server.url, client: "script" });
  const before = (await call("scene.summary", {}, { server: server.url })).result;
  const prompt = `${c.prompt.replace("{code}", code)}\n\n(The synergon shared scene of this repository is running locally; act on it.)`;
  const common = ["-p", prompt, "--model", model, "--output-format", "stream-json", "--verbose", "--max-turns", "12", "--permission-mode", "dontAsk"];
  const argv = variant === "v2"
    ? [...common, "--strict-mcp-config", "--mcp-config", mcpConfig, "--tools", "", "--allowedTools", "mcp__synergon__*"]
    : [...common, "--strict-mcp-config", "--mcp-config", emptyMcp, "--allowedTools", "Bash(bun run rig:*)", "Bash(bun tools/rig.ts:*)", "Read", "Grep", "Glob", "Skill"];
  const t0 = performance.now();
  const p = spawn([CLAUDE, ...argv], { cwd: variant === "v2" ? ROOT : baselineDir, env: { ...process.env, RIG_URL: server.url, RIG_WORKSPACE: WS }, stdout: "pipe", stderr: "pipe" });
  const killer = setTimeout(() => p.kill(), 240_000);
  const out = await new Response(p.stdout).text();
  await p.exited; clearTimeout(killer);
  const seconds = (performance.now() - t0) / 1000;
  const lines = out.split("\n").filter((l) => l.trim().startsWith("{")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const toolCalls = lines.filter((m: any) => m.type === "assistant").flatMap((m: any) => (m.message?.content ?? []).filter((b: any) => b.type === "tool_use").map((b: any) => b.name));
  const result = lines.find((m: any) => m.type === "result") ?? {};
  const answer: string = result.result ?? "";
  // score from the scene
  const after = (await call("scene.summary", {}, { server: server.url })).result;
  const pose = (id: string, from: any) => { const m = from.moved.find((x: any) => x.joint === id); return m ? m.value : units(id, joints.get(id).neutral); };
  const problems: string[] = [];
  const expected = { ...Object.fromEntries(Object.keys(c.preset ?? {}).map((id) => [id, pose(id, before)])), ...(c.expect.pose ?? {}) };
  for (const id of new Set([...Object.keys(expected), ...after.moved.map((m: any) => m.joint)])) {
    const want = expected[id] ?? units(id, joints.get(id).neutral), got = pose(id, after), tol = joints.get(id).type === "prismatic" ? 0.002 : 0.6;
    if (Math.abs(got - want) > tol) problems.push(`${id} is ${got}, expected ${want}`);
  }
  if (c.expect.view) { const v = await page.evaluate("viewer.state().view"); if (v !== c.expect.view) problems.push(`view is ${v}, expected ${c.expect.view}`); }
  if (c.expect.person !== undefined) {                       // the person in the seat afterwards (scene.summary person): these fields, or nobody
    const p = after.person ?? null, want = c.expect.person;
    if (want === null ? p !== null : !p || Object.entries(want).some(([k, v]) => JSON.stringify(p[k]) !== JSON.stringify(v))) problems.push(`person is ${p ? JSON.stringify({ preset: p.preset, sex: p.sex, style: p.style, posture: p.posture, glasses: p.glasses }) : "nobody"}, expected ${JSON.stringify(want)}`);
  }
  if (c.expect.asks && !/\?/.test(answer)) problems.push("did not ask");
  for (const s of c.expect.says ?? []) if (!new RegExp(s, "i").test(answer)) problems.push(`answer lacks /${s}/`);
  return {
    case: c.id, variant, pass: problems.length === 0, problems, tool_calls: toolCalls.length, tools: toolCalls, turns: result.num_turns ?? null,
    seconds: Math.round(seconds * 10) / 10, cost_usd: result.total_cost_usd ?? null, output_tokens: result.usage?.output_tokens ?? null,
    answer: answer.slice(0, 600),
  };
}

const results: any[] = [];
try {
  for (const c of cases) for (const variant of variants) for (let k = 0; k < runs; k++) {
    const r = await runCase(c, variant);
    results.push(r);
    console.log(`${r.pass ? "ok  " : "FAIL"} ${variant.padEnd(8)} ${c.id.padEnd(18)} ${String(r.tool_calls).padStart(2)} calls ${String(r.seconds).padStart(6)} s  ${r.cost_usd !== null ? `$${r.cost_usd.toFixed(3)}` : ""}${r.problems.length ? `  ${r.problems.join("; ")}` : ""}`);
  }
} finally { await browser.close(); server.stop(); rmSync(data, { recursive: true, force: true }); }

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const summary = variants.map((v) => {
  const rs = results.filter((r) => r.variant === v);
  return { variant: v, cases: rs.length, passed: rs.filter((r) => r.pass).length, median_tool_calls: median(rs.map((r) => r.tool_calls)), median_seconds: median(rs.map((r) => r.seconds)), total_seconds: Math.round(rs.reduce((a, r) => a + r.seconds, 0)), total_cost_usd: Math.round(rs.reduce((a, r) => a + (r.cost_usd ?? 0), 0) * 1000) / 1000 };
});
console.log("\n" + summary.map((s) => `${s.variant}: ${s.passed}/${s.cases} passed; median ${s.median_tool_calls} tool calls, ${s.median_seconds} s; ${s.total_seconds} s and $${s.total_cost_usd} in all`).join("\n"));
const outFile = opt("--out");
if (outFile) writeFileSync(outFile, JSON.stringify({ model, date: new Date().toISOString(), summary, results }, null, 2));
process.exit(results.every((r) => r.pass) ? 0 : 1);
