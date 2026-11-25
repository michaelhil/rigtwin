// Local run of tools/live-idle-test.ts (builder D, step 1): the built server (dist/server/server.js, local mode, empty
// temporary data folder) directly, and behind the dist verify proxy (tools/dist.ts serveFolder, Caddy's routes) under
// the root /. One run after the other, each idle for --minutes (default 0.5, longer than Bun's default 10 s idle timeout).
//   bun tools/deploy-tests/idle-local.ts [--minutes 0.5]
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveFolder } from "../dist.ts";
import { LIMITS } from "../../server/limits.ts";

const repo = join(import.meta.dir, "..", ".."), dist = join(repo, "dist");
const minutes = process.argv.includes("--minutes") ? process.argv[process.argv.indexOf("--minutes") + 1] : "0.5";
const data = mkdtempSync(join(tmpdir(), "idle-local-"));
const free = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() }), port = free.port; free.stop(true);
const srv = Bun.spawn([process.execPath, join(dist, "server", "server.js"), "--mode", "local", "--port", String(port), "--data", data, "--asset", join(dist, "asset")], { stdout: "pipe", stderr: "inherit" });
const first = new TextDecoder().decode((await srv.stdout.getReader().read()).value);
console.log(`server: ${first.trim()}`);
const proxy = serveFolder(dist, "/", { api: `http://127.0.0.1:${port}`, idleTimeout: LIMITS.idleTimeoutS });
const run = async (name: string, url: string) => {
  const p = Bun.spawn([process.execPath, join(repo, "tools", "live-idle-test.ts"), "--url", url, "--minutes", minutes], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  console.log(`\n== ${name}: ${url} (exit ${code})\n${out}${err}`);
  return code;
};
// one after the other: both change the same joint of the one scene (the Playground, which live-idle-test finds by name)
const codes = [await run("direct", `http://127.0.0.1:${port}`), await run("through the Caddy-like proxy", proxy.origin)];
proxy.server.stop(true); srv.kill(); rmSync(data, { recursive: true, force: true });
console.log(`idle-local: ${codes.every((c) => c === 0) ? "both ok" : "FAILED"}`);
process.exit(codes.every((c) => c === 0) ? 0 : 1);
