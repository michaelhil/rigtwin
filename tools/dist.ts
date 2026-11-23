// bun run dist [--out dist] [--no-verify] [--strict-wiki]
// Assembles the self-contained deployable folder:
//   dist/index.html, viewer.css, viewer.js     the bundled viewer (three.js included)
//   dist/asset/rig-b.glb, rig-b.manifest.json  the asset
//   dist/wiki/                                 the wiki as a static site (built here, from wiki/*.md and wiki/img/)
//   dist/version.json                          build time, source revision, model hash and triangle count
// Nothing from private/ or work/ is copied. All URLs are relative, so the folder works from any
// sub-path. Unless --no-verify is given, the result is served from the sub-path /rigtwin/ by a
// throwaway local server and loaded in headless Chromium: the viewer, its link to the documentation,
// and several wiki pages. Every request must succeed and no page may log an error.
import { mkdirSync, rmSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname, normalize, sep } from "node:path";
import { createHash } from "node:crypto";
import { ROOT, timeline } from "./timeline.ts";
import { bundleViewer } from "./bundle.ts";
import { buildWiki, lintWiki } from "./wiki.ts";
import { currentVersion } from "./version.ts";

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".glb": "model/gltf-binary", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".gif": "image/gif", ".webp": "image/webp" };

/** Static file server for `dir` under the path `base`, behaving like a plain web server: index.html for a folder, a redirect when the folder's slash is missing, 404 otherwise. Every answer is logged. */
export function serveFolder(dir: string, base = "/rigtwin/") {
  const log: { path: string; status: number }[] = [];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const answer = (status: number, body: BodyInit | null, headers: Record<string, string> = {}) => { log.push({ path, status }); return new Response(body, { status, headers }); };
    if (path + "/" === base) return answer(301, null, { location: base });
    if (!path.startsWith(base)) return answer(404, "outside the sub-path");
    let file = normalize(join(dir, path.slice(base.length)));
    if (file !== dir && !file.startsWith(dir + sep)) return answer(404, "not found");
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!path.endsWith("/")) return answer(301, null, { location: path + "/" });
      file = join(file, "index.html");
    }
    if (!existsSync(file)) return answer(404, "not found");
    return answer(200, Bun.file(file), { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream" });
  } });
  return { server, log, origin: `http://127.0.0.1:${server.port}`, base };
}

const listFiles = (dir: string) => { const files: string[] = []; const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } }; if (existsSync(dir)) walk(dir); return files; };
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

if (import.meta.main) {
  const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const out = join(ROOT, opt("--out") ?? "dist"), asset = "rig-b", buildDir = join(ROOT, "assets", asset, "build");
  const t0 = performance.now();
  if (!existsSync(join(buildDir, `${asset}.glb`))) { console.error('error: no build found. Run "bun run build" first.'); process.exit(1); }
  const manifest = JSON.parse(readFileSync(join(buildDir, `${asset}.manifest.json`), "utf8"));
  if (manifest.build.partial) { console.error(`error: the current build is partial (only ${manifest.build.only.join(", ")}). Run a full "bun run build" first.`); process.exit(1); }
  if (manifest.missing.length) { console.error(`error: components without geometry and not declared omitted: ${manifest.missing.join(", ")}`); process.exit(1); }

  const bundle = await bundleViewer();
  const version = currentVersion({ buildDir, asset });
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "asset"), { recursive: true });
  for (const [name, f] of Object.entries(bundle.files)) writeFileSync(join(out, name), f.body);
  for (const f of [`${asset}.glb`, `${asset}.manifest.json`]) copyFileSync(join(buildDir, f), join(out, "asset", f));
  writeFileSync(join(out, "version.json"), JSON.stringify(version, null, 1) + "\n");
  const wiki = buildWiki({ out: join(out, "wiki"), version });

  const files = listFiles(out), size = (list: string[]) => list.reduce((n, f) => n + statSync(f).size, 0);
  const wikiFiles = files.filter((f) => f.startsWith(join(out, "wiki") + sep)), total = size(files);
  console.log(`dist: ${files.length} files, ${(total / 1e6).toFixed(2)} MB → ${out}   (version ${version.short})`);
  for (const f of files.filter((x) => !wikiFiles.includes(x))) console.log(`  ${f.slice(out.length + 1).padEnd(32)} ${statSync(f).size.toLocaleString("en")} bytes`);
  console.log(`  ${"wiki/".padEnd(32)} ${size(wikiFiles).toLocaleString("en")} bytes in ${wikiFiles.length} files (${wiki.pages} pages, ${wikiFiles.filter((f) => /\.(png|jpe?g|svg|gif|webp)$/i.test(f)).length} images)`);

  let ok = true;
  const fail = (message: string) => { ok = false; console.error("FAILED: " + message); };
  // The wiki is written by several people at once, so pages that link to pages not written yet are normal while it grows:
  // dist only warns about them (--strict-wiki makes them an error). `bun run deploy` refuses to publish unless
  // `bun run wiki lint` passes (or --allow-lint is given).
  const lint = lintWiki();
  if (wiki.problems.length || lint.errors) {
    const say = args.includes("--strict-wiki") ? fail : (m: string) => console.warn("warning: " + m);
    say(`wiki: ${wiki.problems.length} broken link(s) or image(s) in the site; wiki lint: ${lint.summary}`);
    for (const p of wiki.problems.slice(0, 8)) console.warn("  " + p);
    if (wiki.problems.length > 8) console.warn(`  … and ${wiki.problems.length - 8} more ('bun run wiki lint' lists every finding with its line)`);
  } else console.log(`wiki: every link and image of the site resolves; wiki lint: ${lint.summary}`);

  // nothing from private/ may be in the distribution: no file of dist/ is a byte-for-byte copy of a file under private/
  {
    const bySize = new Map<number, string[]>();
    for (const f of listFiles(join(ROOT, "private"))) { const n = statSync(f).size; bySize.set(n, [...(bySize.get(n) ?? []), f]); }
    const copies = files.filter((f) => (bySize.get(statSync(f).size) ?? []).some((p) => sha(p) === sha(f)));
    if (copies.length) fail(`file(s) identical to a file under private/: ${copies.map((f) => f.slice(out.length + 1)).join(", ")}`);
    else console.log(`private check: no file of the distribution is a copy of a file under private/ (${[...bySize.values()].flat().length} private files compared by size and hash)`);
  }

  if (!args.includes("--no-verify")) {
    const { server, log, origin, base } = serveFolder(out);
    const { Browser } = await import("./render.ts");
    const browser = await Browser.launch();
    const errors: string[] = [];
    try {
      // 1. the viewer, its Documentation link and its version line
      const page = await browser.page(`${origin}${base}`);
      await page.viewport(1600, 1000);
      await page.waitFor("window.viewerReady || window.viewerError", "the deployed viewer");
      const err = await page.evaluate("window.viewerError || null"), st = await page.evaluate("window.viewerReady ? viewer.state() : null");
      if (err) errors.push("viewer: " + err);
      if (!(st?.render.triangles > 0)) errors.push("viewer: nothing drawn");
      await page.evaluate("document.getElementById('more-btn').click()");
      const shown = await page.waitFor("(() => { const v = document.querySelector('#more .about .version'); return v && v.textContent ? v.textContent : null; })()", "the version line in the More menu", 5000).catch(() => null);
      const docHref = await page.evaluate("document.querySelector('#more .about a')?.href ?? null");
      if (shown !== `Version ${version.short}`) errors.push(`viewer: the More menu shows '${shown}', expected 'Version ${version.short}'`);
      if (docHref !== `${origin}${base}wiki/`) errors.push(`viewer: the Documentation link leads to ${docHref}`);
      errors.push(...page.errors.map((e) => "viewer console: " + e));
      await page.close();
      // 2. wiki pages: the index (also without its trailing slash), then a spread of pages
      const has = (re: RegExp) => wiki.pageUrls.filter((u) => re.test(u));
      // the page with the most images (each must load), besides the index, the summary and this deployment page
      const imgCount = (u: string) => (readFileSync(join(out, "wiki", u), "utf8").match(/<img\b/g) ?? []).length;
      const withFigure = [...wiki.pageUrls].sort((a, b) => imgCount(b) - imgCount(a)).find((u) => imgCount(u) > 0);
      const longest = [...wiki.pageUrls].sort((a, b) => statSync(join(out, "wiki", b)).size - statSync(join(out, "wiki", a)).size)[0];
      const sample = [...new Set(["", ...has(/summary\.html$/), ...has(/deployment\.html$/), ...(withFigure ? [withFigure] : []), longest, "README.html", ...wiki.pageUrls.slice(1, 3)])].slice(0, 8);
      let images = 0, clicked = "";
      for (const u of sample) {
        const p = await browser.page(`${origin}${base}wiki${u === "" ? "" : "/" + u}`);   // "" asks for /rigtwin/wiki and must be redirected to /rigtwin/wiki/
        await p.viewport(1280, 900);
        await p.waitFor("document.readyState === 'complete'", `wiki page ${u || "index"}`);
        const r = await p.evaluate(`(async () => {
          const imgs = [...document.images]; imgs.forEach((i) => { i.loading = 'eager'; });
          const loaded = await Promise.all(imgs.map((i) => i.decode().then(() => i.naturalWidth > 0, () => false)));
          const q = document.getElementById('q'); q.value = document.querySelector('#nav h2 + ul a').textContent.split(' ')[0]; q.dispatchEvent(new Event('input'));
          return { title: document.title, h1: document.querySelector('h1')?.textContent ?? '', styled: getComputedStyle(document.querySelector('.tldr')).borderLeftWidth === '4px',
            robots: document.querySelector('meta[name=robots]')?.content ?? '', images: imgs.length, broken: imgs.filter((_, k) => !loaded[k]).map((i) => i.getAttribute('src')),
            hits: document.querySelectorAll('#hits a').length, viewer: document.querySelector('.top .viewer').href, path: location.pathname };
        })()`);
        images += r.images;
        const name = `wiki/${u || "(index, asked for without the trailing slash)"}`;
        if (!r.h1 || !r.title.includes("rigtwin wiki")) errors.push(`${name}: no title`);
        if (!r.styled) errors.push(`${name}: stylesheet not applied`);
        if (!r.robots.includes("noindex")) errors.push(`${name}: no noindex`);
        if (r.broken.length) errors.push(`${name}: image(s) not loaded: ${r.broken.join(", ")}`);
        if (!r.hits) errors.push(`${name}: search found nothing for a word of a page title`);
        if (r.viewer !== `${origin}${base}`) errors.push(`${name}: viewer link leads to ${r.viewer}`);
        if (u === "" && r.path !== `${base}wiki/`) errors.push(`wiki without trailing slash ended at ${r.path}`);
        if (u === sample[1]) {   // follow links like a reader: next page, then a navigation entry, then back to the viewer
          for (const [what, sel] of [["next-page link", ".pager .next"], ["navigation entry", "#nav h2 ~ ul a:not([aria-current])"], ["viewer link", ".top .viewer"]]) {
            const before = await p.evaluate("location.pathname");
            if (!(await p.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`))) continue;
            await p.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
            const after = await p.waitFor(`location.pathname !== ${JSON.stringify(before)} && document.readyState === 'complete' ? location.pathname : null`, `the page behind the ${what}`, 8000).catch(() => null);
            if (!after) { errors.push(`${name}: the ${what} did not lead anywhere`); break; }
            clicked += `${clicked ? ", " : ""}${what} → ${after.replace(base, "") || "viewer"}`;
          }
          if (clicked.endsWith("viewer")) { await p.waitFor("window.viewerReady || window.viewerError", "the viewer behind the wiki's link"); if (await p.evaluate("window.viewerError || null")) errors.push("viewer reached from the wiki failed to load"); }
        }
        errors.push(...p.errors.map((e) => `${name} console: ${e}`));
        await p.close();
      }
      const failed = log.filter((l) => l.status >= 400), stray = log.filter((l) => !l.path.startsWith(base.slice(0, -1)) || /(^|\/)(private|work)\//.test(l.path));
      for (const l of failed) errors.push(`request failed: ${l.path} (${l.status})`);
      for (const l of stray) errors.push(`stray request: ${l.path}`);
      const good = log.filter((l) => l.status === 200).length;
      console.log(`verify from ${base}: ${errors.length ? "FAILED" : "ok"}: viewer drew ${st?.render.triangles ?? 0} triangles and links to the documentation; ${sample.length} wiki pages loaded (${sample.map((u) => u || "index").join(", ")}) with ${images} images; followed ${clicked || "no links"}; ${good} requests answered, ${failed.length} failed, ${[...new Set(errors)].length} problem(s)`);
      for (const e of [...new Set(errors)]) fail(e);
    } catch (e: any) { fail("verify: " + e.message); }
    await browser.close(); server.stop(true);
  }
  const seconds = (performance.now() - t0) / 1000;
  console.log(`dist ${ok ? "done" : "FAILED"} in ${seconds.toFixed(2)} s`);
  timeline(ok ? "dist" : "dist failed", seconds, `${files.length} files, ${total} bytes (wiki ${size(wikiFiles)} bytes, ${wiki.pages} pages), viewer bundle ${bundle.files["viewer.js"].body.length} bytes in ${bundle.seconds.toFixed(2)} s, wiki built in ${wiki.seconds.toFixed(2)} s; wiki ${wiki.problems.length} broken links, lint ${lint.errors} errors`);
  process.exit(ok ? 0 : 1);
}
